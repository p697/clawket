/** Positively identify the native session-history fallback; older APIs keep their existing path. */
export async function supportsNativeRunContext(run: <T>(script: string) => Promise<T>): Promise<boolean> {
  try {
    return await run<boolean>(`
import ast, importlib, inspect, json, textwrap
supported = False
for name in ('gateway.platforms.api_server_runs', 'gateway.platforms.api_server'):
    try:
        module = importlib.import_module(name)
        handler = getattr(module, '_handle_runs', None)
        if handler is None:
            handler = getattr(getattr(module, 'APIServerAdapter', None), '_handle_runs', None)
        tree = ast.parse(textwrap.dedent(inspect.getsource(handler)))
        for node in ast.walk(tree):
            if not isinstance(node, ast.If): continue
            test = ast.unparse(node.test)
            body = ast.unparse(ast.Module(body=node.body, type_ignores=[]))
            if test == 'not conversation_history and session_id and (not previous_response_id)' and body == 'conversation_history = await self._conversation_history_for_session(str(session_id))':
                supported = True
    except (ImportError, AttributeError, TypeError, OSError, SyntaxError):
        pass
print(json.dumps(supported))
`) === true;
  } catch { return false; }
}
