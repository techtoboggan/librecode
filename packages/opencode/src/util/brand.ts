declare const __brand: unique symbol

/**
 * Branded type helper. Produces a nominal type that is structurally
 * compatible with `T` but distinguishable at the type level.
 *
 * @example
 *   type SessionID = Brand<string, "SessionID">
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B }
