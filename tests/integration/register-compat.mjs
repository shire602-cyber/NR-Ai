// W5-E (R17-14): POST /api/auth/register answers generically and never returns a session,
// so a new account and an existing one are indistinguishable. Integration scripts that
// need a fresh tenant sign in right after registering, exactly like the web client does.
//
// withRegisterLogin(rawApi, shape) wraps a script's `api(method, path, opts)` helper: a
// successful register call is followed by /api/auth/login and GET /api/companies, and the
// register response body gains { token, user, company } so the rest of the script is
// unchanged. `shape` names the status/body keys of the helper's result.
export function withRegisterLogin(rawApi, shape = { status: "status", body: "json" }) {
  return async function api(method, path, opts = {}) {
    const r = await rawApi(method, path, opts);
    const body = r[shape.body];
    if (method === "POST" && path === "/api/auth/register" && r[shape.status] === 200 && !body?.token) {
      const login = await rawApi("POST", "/api/auth/login", {
        body: { email: opts.body?.email, password: opts.body?.password },
      });
      const token = login[shape.body]?.token;
      if (token) {
        const companies = await rawApi("GET", "/api/companies", { token });
        const list = companies[shape.body];
        r[shape.body] = {
          ...(body ?? {}),
          token,
          user: login[shape.body].user,
          company: Array.isArray(list) ? list[0] : undefined,
        };
      }
    }
    return r;
  };
}
