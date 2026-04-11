import { Hono } from "hono"
import { stream } from "hono/streaming"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID, MessageID, PartID } from "@/session/schema"
import z from "zod"
import { Session } from "../../../session"
import { MessageV2 } from "../../../session/message-v2"
import { SessionPrompt } from "../../../session/prompt"
import { errors } from "../../error"

export const SessionMessageRoutes = new Hono()
  .get(
    "/:sessionID/message",
    describeRoute({
      summary: "Get session messages",
      description: "Retrieve all messages in a session, including user prompts and AI responses.",
      operationId: "session.messages",
      responses: {
        200: {
          description: "List of messages",
          content: {
            "application/json": {
              schema: resolver(MessageV2.WithParts.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    validator(
      "query",
      z
        .object({
          limit: z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .meta({ description: "Maximum number of messages to return" }),
          before: z
            .string()
            .optional()
            .meta({ description: "Opaque cursor for loading older messages" })
            .refine(
              (value) => {
                if (!value) return true
                try {
                  MessageV2.cursor.decode(value)
                  return true
                } catch {
                  return false
                }
              },
              { message: "Invalid cursor" },
            ),
        })
        .refine((value) => !value.before || value.limit !== undefined, {
          message: "before requires limit",
          path: ["before"],
        }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const sessionID = c.req.valid("param").sessionID
      if (query.limit === undefined) {
        await Session.get(sessionID)
        const messages = await Session.messages({ sessionID })
        return c.json(messages)
      }

      if (query.limit === 0) {
        await Session.get(sessionID)
        const messages = await Session.messages({ sessionID })
        return c.json(messages)
      }

      const page = await MessageV2.page({
        sessionID,
        limit: query.limit,
        before: query.before,
      })
      if (page.cursor) {
        const url = new URL(c.req.url)
        url.searchParams.set("limit", query.limit.toString())
        url.searchParams.set("before", page.cursor)
        c.header("Access-Control-Expose-Headers", "Link, X-Next-Cursor")
        c.header("Link", `<${url.toString()}>; rel=\"next\"`)
        c.header("X-Next-Cursor", page.cursor)
      }
      return c.json(page.items)
    },
  )
  .get(
    "/:sessionID/message/:messageID",
    describeRoute({
      summary: "Get message",
      description: "Retrieve a specific message from a session by its message ID.",
      operationId: "session.message",
      responses: {
        200: {
          description: "Message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Info,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
      }),
    ),
    async (c) => {
      const params = c.req.valid("param")
      const message = await MessageV2.get({
        sessionID: params.sessionID,
        messageID: params.messageID,
      })
      return c.json(message)
    },
  )
  .delete(
    "/:sessionID/message/:messageID",
    describeRoute({
      summary: "Delete message",
      description:
        "Permanently delete a specific message (and all of its parts) from a session. This does not revert any file changes that may have been made while processing the message.",
      operationId: "session.deleteMessage",
      responses: {
        200: {
          description: "Successfully deleted message",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
      }),
    ),
    async (c) => {
      const params = c.req.valid("param")
      SessionPrompt.assertNotBusy(params.sessionID)
      await Session.removeMessage({
        sessionID: params.sessionID,
        messageID: params.messageID,
      })
      return c.json(true)
    },
  )
  .delete(
    "/:sessionID/message/:messageID/part/:partID",
    describeRoute({
      description: "Delete a part from a message",
      operationId: "part.delete",
      responses: {
        200: {
          description: "Successfully deleted part",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
        partID: PartID.zod,
      }),
    ),
    async (c) => {
      const params = c.req.valid("param")
      await Session.removePart({
        sessionID: params.sessionID,
        messageID: params.messageID,
        partID: params.partID,
      })
      return c.json(true)
    },
  )
  .patch(
    "/:sessionID/message/:messageID/part/:partID",
    describeRoute({
      description: "Update a part in a message",
      operationId: "part.update",
      responses: {
        200: {
          description: "Successfully updated part",
          content: {
            "application/json": {
              schema: resolver(MessageV2.Part),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
        messageID: MessageID.zod,
        partID: PartID.zod,
      }),
    ),
    validator("json", MessageV2.Part),
    async (c) => {
      const params = c.req.valid("param")
      const body = c.req.valid("json")
      if (body.id !== params.partID || body.messageID !== params.messageID || body.sessionID !== params.sessionID) {
        throw new Error(
          `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
        )
      }
      const part = await Session.updatePart(body)
      return c.json(part)
    },
  )
  .post(
    "/:sessionID/message",
    describeRoute({
      summary: "Send message",
      description: "Create and send a new message to a session, streaming the AI response.",
      operationId: "session.prompt",
      responses: {
        200: {
          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Assistant,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
    async (c) => {
      c.status(200)
      c.header("Content-Type", "application/json")
      return stream(c, async (stream) => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        const msg = await SessionPrompt.prompt({ ...body, sessionID })
        stream.write(JSON.stringify(msg))
      })
    },
  )
  .post(
    "/:sessionID/prompt_async",
    describeRoute({
      summary: "Send async message",
      description:
        "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
      operationId: "session.prompt_async",
      responses: {
        204: {
          description: "Prompt accepted",
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
    async (c) => {
      c.status(204)
      c.header("Content-Type", "application/json")
      return stream(c, async () => {
        const sessionID = c.req.valid("param").sessionID
        const body = c.req.valid("json")
        SessionPrompt.prompt({ ...body, sessionID })
      })
    },
  )
  .post(
    "/:sessionID/command",
    describeRoute({
      summary: "Send command",
      description: "Send a new command to a session for execution by the AI assistant.",
      operationId: "session.command",
      responses: {
        200: {
          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  info: MessageV2.Assistant,
                  parts: MessageV2.Part.array(),
                }),
              ),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const msg = await SessionPrompt.command({ ...body, sessionID })
      return c.json(msg)
    },
  )
  .post(
    "/:sessionID/shell",
    describeRoute({
      summary: "Run shell command",
      description: "Execute a shell command within the session context and return the AI's response.",
      operationId: "session.shell",
      responses: {
        200: {
          description: "Created message",
          content: {
            "application/json": {
              schema: resolver(MessageV2.Assistant),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const body = c.req.valid("json")
      const msg = await SessionPrompt.shell({ ...body, sessionID })
      return c.json(msg)
    },
  )
