import { Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { AuthService } from "@/auth/service"
import { PermissionService } from "@/permission/service"
// QuestionService migrated to plain async (ADR-001) — no longer needs Effect layer

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(AccountService.defaultLayer, AuthService.defaultLayer, PermissionService.layer),
)
