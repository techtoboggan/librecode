import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { Session } from "../../../session"
import { Todo } from "../../../session/todo"
import { SessionStatus } from "@/session/status"
import { Log } from "../../../util/log"
import { errors } from "../../error"

const log = Log.create({ service: "server" })

export const SessionCrudRoutes = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List sessions",
      description: "Get a list of all LibreCode sessions, sorted by most recently updated.",
      operationId: "session.list",
      responses: {
        200: {
          description: "List of sessions",
          content: {
            "application/json": {
              schema: resolver(Session.Info.array()),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
        roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
        start: z.coerce
          .number()
          .optional()
          .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
        search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
        limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const sessions: Session.Info[] = []
      for await (const session of Session.list({
        directory: query.directory,
        roots: query.roots,
        start: query.start,
        search: query.search,
        limit: query.limit,
      })) {
        sessions.push(session)
      }
      return c.json(sessions)
    },
  )
  .get(
    "/status",
    describeRoute({
      summary: "Get session status",
      description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
      operationId: "session.status",
      responses: {
        200: {
          description: "Get session status",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), SessionStatus.Info)),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const result = SessionStatus.list()
      return c.json(result)
    },
  )
  .get(
    "/:sessionID",
    describeRoute({
      summary: "Get session",
      description: "Retrieve detailed information about a specific LibreCode session.",
      tags: ["Session"],
      operationId: "session.get",
      responses: {
        200: {
          description: "Get session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: Session.get.schema,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      log.info("SEARCH", { url: c.req.url })
      const session = await Session.get(sessionID)
      return c.json(session)
    },
  )
  .get(
    "/:sessionID/children",
    describeRoute({
      summary: "Get session children",
      tags: ["Session"],
      description: "Retrieve all child sessions that were forked from the specified parent session.",
      operationId: "session.children",
      responses: {
        200: {
          description: "List of children",
          content: {
            "application/json": {
              schema: resolver(Session.Info.array()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: Session.children.schema,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const session = await Session.children(sessionID)
      return c.json(session)
    },
  )
  .get(
    "/:sessionID/todo",
    describeRoute({
      summary: "Get session todos",
      description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
      operationId: "session.todo",
      responses: {
        200: {
          description: "Todo list",
          content: {
            "application/json": {
              schema: resolver(Todo.Info.array()),
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
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const todos = await Todo.get(sessionID)
      return c.json(todos)
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Create session",
      description: "Create a new LibreCode session for interacting with AI assistants and managing conversations.",
      operationId: "session.create",
      responses: {
        ...errors(400),
        200: {
          description: "Successfully created session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
            },
          },
        },
      },
    }),
    validator("json", Session.create.schema.optional()),
    async (c) => {
      const body = c.req.valid("json") ?? {}
      const session = await Session.create(body)
      return c.json(session)
    },
  )
  .delete(
    "/:sessionID",
    describeRoute({
      summary: "Delete session",
      description: "Delete a session and permanently remove all associated data, including messages and history.",
      operationId: "session.delete",
      responses: {
        200: {
          description: "Successfully deleted session",
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
        sessionID: Session.remove.schema,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      await Session.remove(sessionID)
      return c.json(true)
    },
  )
  .patch(
    "/:sessionID",
    describeRoute({
      summary: "Update session",
      description: "Update properties of an existing session, such as title or other metadata.",
      operationId: "session.update",
      responses: {
        200: {
          description: "Successfully updated session",
          content: {
            "application/json": {
              schema: resolver(Session.Info),
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
      "json",
      z.object({
        title: z.string().optional(),
        time: z
          .object({
            archived: z.number().optional(),
          })
          .optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const updates = c.req.valid("json")

      let session = await Session.get(sessionID)
      if (updates.title !== undefined) {
        session = await Session.setTitle({ sessionID, title: updates.title })
      }
      if (updates.time?.archived !== undefined) {
        session = await Session.setArchived({ sessionID, time: updates.time.archived })
      }

      return c.json(session)
    },
  )
