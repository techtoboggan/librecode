import { Hono } from "hono"
import { lazy } from "../../../util/lazy"
import { SessionCrudRoutes } from "./crud"
import { SessionMessageRoutes } from "./messages"
import { SessionActionRoutes } from "./actions"

export const SessionRoutes = lazy(() =>
  new Hono()
    .route("/", SessionCrudRoutes)
    .route("/", SessionActionRoutes)
    .route("/", SessionMessageRoutes),
)
