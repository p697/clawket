type RuntimeOwner = { retire(): void };
type RuntimeScope = { __clawketConnectionRuntimeOwner?: RuntimeOwner };

/** Metro replaces modules, but sockets, timers and store listeners outlive them. */
export function ownConnectionRuntime<T extends RuntimeOwner>(
  runtime: T,
  scope: RuntimeScope = globalThis as RuntimeScope,
): T {
  const previous = scope.__clawketConnectionRuntimeOwner;
  if (previous !== runtime) {
    // Retire synchronously detaches sockets, timers and subscriptions and
    // prevents old React effects from starting the superseded owner again.
    previous?.retire();
    scope.__clawketConnectionRuntimeOwner = runtime;
  }
  return runtime;
}
