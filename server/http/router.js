// server/http/router.js
//
// Минимальный роутер на нативном Node.js.
// Поддерживает: точные пути, параметры пути (/api/rooms/:roomId), query-строку.

/**
 * @typedef {(req: import('http').IncomingMessage, res: import('http').ServerResponse, ctx: {params: Object, query: URLSearchParams}) => Promise<void>|void} RouteHandler
 */

function matchPath(pattern, pathname) {
  if (!pattern.includes(':')) {
    return pattern === pathname ? {} : null;
  }

  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (p !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

export function createRouter() {
  /** @type {Array<{method: string, pattern: string, handler: RouteHandler}>} */
  const routes = [];

  return {
    /**
     * @param {string} method
     * @param {string} pattern
     * @param {RouteHandler} handler
     */
    add(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), pattern, handler });
    },

    /**
     * Пытается найти и выполнить роут.
     * @returns {Promise<boolean>} true, если роут найден и выполнен
     */
    async handle(req, res) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const params = matchPath(route.pattern, pathname);
        if (params === null) continue;

        await route.handler(req, res, { params, query: url.searchParams });
        return true;
      }
      return false;
    }
  };
}