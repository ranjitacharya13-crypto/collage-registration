// Works out the Supabase REST API base URL from whatever was pasted into
// SUPABASE_URL, and keeps secrets out of anything we log or return.
//
// The Supabase dashboard shows several different strings and it is very easy
// to copy the wrong one. The most common mix-up is the database connection
// string from "Connect" -> "URI":
//
//   postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres
//
// That is for a Postgres driver, not for PostgREST. Previously this was a hard
// failure that took the whole API down. Both forms contain the project ref, so
// we now derive the correct API URL instead of refusing to work — and, just as
// importantly, we never echo the password back in an error message.

/** Project ref -> the REST API origin. */
const apiUrlFor = ref => `https://${ref}.supabase.co`;

const REF = '[a-z0-9]{16,}';

/**
 * Normalises SUPABASE_URL.
 *
 * @param {string} raw whatever is in the environment variable
 * @returns {{url: string, ref: string|null, derivedFrom: string|null, warning: string|null, error: string|null}}
 */
export function resolveSupabaseUrl(raw) {
  const input = String(raw || '').trim();
  const empty = { url: '', ref: null, derivedFrom: null, warning: null, error: null };
  if (!input) return empty;

  // 1. A Postgres connection string (direct or pooled).
  if (/^postgres(ql)?:\/\//i.test(input)) {
    const ref = refFromConnectionString(input);
    if (ref) {
      return {
        url: apiUrlFor(ref),
        ref,
        derivedFrom: 'connection-string',
        warning: 'SUPABASE_URL is a database connection string, not the API URL. '
          + `Using ${apiUrlFor(ref)} instead. Set SUPABASE_URL to that value `
          + '(Project Settings -> API -> Project URL) and rotate the database '
          + 'password, since it was stored in this variable.',
        error: null,
      };
    }
    return {
      ...empty,
      error: 'SUPABASE_URL is a database connection string and no project ref could be '
        + 'read from it. Use the Project URL: https://<project-ref>.supabase.co',
    };
  }

  // 2. A URL, possibly with the /rest/v1 suffix the dashboard shows.
  if (/^https?:\/\//i.test(input)) {
    const cleaned = stripSuffix(input);
    const ref = cleaned.match(new RegExp(`^https?://(?:db\\.)?(${REF})\\.supabase\\.(?:co|in)$`, 'i'))?.[1] || null;
    // db.<ref>.supabase.co is the database host, not the API host.
    if (ref && /^https?:\/\/db\./i.test(cleaned)) {
      return {
        url: apiUrlFor(ref),
        ref,
        derivedFrom: 'db-host',
        warning: `SUPABASE_URL pointed at the database host. Using ${apiUrlFor(ref)} instead.`,
        error: null,
      };
    }
    if (/^http:\/\//i.test(cleaned) && !/^http:\/\/(localhost|127\.|\[::1\])/i.test(cleaned)) {
      return {
        url: cleaned.replace(/^http:/i, 'https:'),
        ref,
        derivedFrom: 'http-upgrade',
        warning: 'SUPABASE_URL used http://; upgraded to https://.',
        error: null,
      };
    }
    return {
      url: cleaned,
      ref,
      derivedFrom: null,
      // Local mocks in the test suite are legitimate, so only warn on the
      // shape, never fail.
      warning: ref || /^https?:\/\/(localhost|127\.|\[::1\])/i.test(cleaned)
        ? null
        : `SUPABASE_URL does not look like a project URL: ${cleaned}. `
          + 'Expected https://<project-ref>.supabase.co',
      error: null,
    };
  }

  // 3. A hostname with no scheme, e.g. "abcd1234.supabase.co".
  const host = input.match(new RegExp(`^(?:db\\.)?(${REF})\\.supabase\\.(?:co|in)(?:/.*)?$`, 'i'));
  if (host) {
    return {
      url: apiUrlFor(host[1]),
      ref: host[1],
      derivedFrom: 'hostname',
      warning: `SUPABASE_URL had no scheme. Using ${apiUrlFor(host[1])}.`,
      error: null,
    };
  }

  // 4. A bare project ref.
  if (new RegExp(`^${REF}$`, 'i').test(input)) {
    return {
      url: apiUrlFor(input),
      ref: input,
      derivedFrom: 'project-ref',
      warning: `SUPABASE_URL looked like a bare project ref. Using ${apiUrlFor(input)}.`,
      error: null,
    };
  }

  return {
    ...empty,
    error: `SUPABASE_URL is not a usable URL: ${redactSecrets(input)}. `
      + 'Expected https://<project-ref>.supabase.co',
  };
}

/** Pulls the project ref out of either connection-string layout. */
function refFromConnectionString(value) {
  // Direct:  postgresql://postgres:pw@db.<ref>.supabase.co:5432/postgres
  const direct = value.match(new RegExp(`@(?:db\\.)?(${REF})\\.supabase\\.(?:co|in)\\b`, 'i'));
  if (direct) return direct[1];

  // Pooled:  postgresql://postgres.<ref>:pw@aws-0-region.pooler.supabase.com:6543/postgres
  const pooled = value.match(new RegExp(`//postgres\\.(${REF})[:@]`, 'i'));
  if (pooled) return pooled[1];

  return null;
}

const stripSuffix = value =>
  value.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '').replace(/\/+$/, '');

/**
 * Removes anything secret from a string before it is logged or sent to a
 * browser: userinfo in URLs, Supabase keys, and bearer tokens.
 *
 * /api/health is public, so an unredacted driver error there would publish the
 * database password to the internet.
 */
export function redactSecrets(text) {
  let out = String(text ?? '');

  // user:password@host  ->  user:***@host   (in URLs of any scheme)
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+)(:[^/\s@]*)?@/gi,
    (_match, scheme, user) => `${scheme}${user}:***@`);

  // Supabase keys and JWTs, wherever they appear.
  out = out.replace(/\b(sb_secret_|sb_publishable_|sbp_)[A-Za-z0-9_-]+/g, '$1***');
  out = out.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'eyJ***');
  out = out.replace(/\b(Bearer|apikey)[=:\s]+\S+/gi, '$1 ***');

  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (key.length > 6) out = out.split(key).join('***');

  return out;
}
