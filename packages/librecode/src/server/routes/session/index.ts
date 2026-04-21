import { Hono } from "hono"
import { lazy } from "../../../util/lazy"
import { SessionActionRoutes } from "./actions"
import { SessionCrudRoutes } from "./crud"
import { SessionMcpAppRoutes } from "./mcp-apps"
import { SessionMcpAppReadRoutes } from "./mcp-apps-read"
import { SessionMessageRoutes } from "./messages"

export const SessionRoutes = lazy(() =>
  new Hono()
    .route("/", SessionCrudRoutes)
    .route("/", SessionActionRoutes)
    .route("/", SessionMessageRoutes)
    .route("/", SessionMcpAppRoutes)
    .route("/", SessionMcpAppReadRoutes),
)
