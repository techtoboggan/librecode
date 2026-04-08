import { Layer, ManagedRuntime } from "effect"
import { AccountService } from "@/account/service"
import { AuthService } from "@/auth/service"
// QuestionService + PermissionService migrated to plain async (ADR-001)

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(AccountService.defaultLayer, AuthService.defaultLayer),
)
