import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { PermissionNext } from "@/permission/next"
import { PermissionID } from "@/permission/schema"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const PermissionRoutes = lazy(() =>
  new Hono()
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
        operationId: "permission.reply",
        responses: {
          200: {
            description: "Permission processed successfully",
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
          requestID: PermissionID.zod,
        }),
      ),
      validator("json", z.object({ reply: PermissionNext.Reply, message: z.string().optional() })),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await PermissionNext.reply({
          requestID: params.requestID,
          reply: json.reply,
          message: json.message,
        })
        return c.json(true)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
        operationId: "permission.list",
        responses: {
          200: {
            description: "List of pending permissions",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const permissions = await PermissionNext.list()
        return c.json(permissions)
      },
    )
    .get(
      "/rules",
      describeRoute({
        summary: "List persisted permission rules",
        description:
          "Return the project-wide 'Always allow/deny' ruleset. v0.9.52: these are the rules that now actually survive a restart — previously they were in-memory only.",
        operationId: "permission.rules.list",
        responses: {
          200: {
            description: "Persisted ruleset",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Ruleset),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(PermissionNext.listApproved())
      },
    )
    .put(
      "/rules",
      describeRoute({
        summary: "Replace the persisted permission ruleset",
        description: "Atomically overwrite the project's approved ruleset. Used by Settings when the user edits rules.",
        operationId: "permission.rules.replace",
        responses: {
          200: {
            description: "Updated ruleset",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Ruleset),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", PermissionNext.Ruleset),
      async (c) => {
        const ruleset = c.req.valid("json")
        PermissionNext.setApprovedRuleset(ruleset)
        return c.json(PermissionNext.listApproved())
      },
    )
    .delete(
      "/rules",
      describeRoute({
        summary: "Delete a single permission rule",
        description: "Remove the rule matching the given (permission, pattern) pair. Returns the remaining ruleset.",
        operationId: "permission.rules.delete",
        responses: {
          200: {
            description: "Remaining ruleset after deletion",
            content: {
              "application/json": {
                schema: resolver(PermissionNext.Ruleset),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ permission: z.string(), pattern: z.string() })),
      async (c) => {
        const { permission, pattern } = c.req.valid("json")
        PermissionNext.deleteApprovedRule(permission, pattern)
        return c.json(PermissionNext.listApproved())
      },
    ),
)
