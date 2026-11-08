import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { extname, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const port = Number(process.env.PORT ?? 3000);

mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, "blog.sqlite"));
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    body TEXT NOT NULL,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const seed = db.prepare(`
  INSERT OR IGNORE INTO posts
    (id, author_id, title, category, excerpt, body, image, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const demoAuthor = "fieldnotes-editor";
db.prepare(
  "INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
).run(demoAuthor, "Fieldnotes Journal", "editor@fieldnotes.blog", "seed-account", new Date().toISOString());

const today = Date.now();
const stories = [
  {
    id: "story-slower-mornings",
    title: "The quiet art of a slower morning",
    category: "Wellbeing",
    excerpt: "What happens when the first hour of the day belongs to you, and no one else?",
    body: "Some mornings begin before the world has had a chance to ask anything of us. In that small, unclaimed space, a kettle comes to a boil, the light changes on the kitchen wall, and everything feels a little less urgent.\n\nA slower morning is not a routine to perfect. It is an invitation to notice what was already there: the warmth of a mug, a few deep breaths, a page in a book you meant to finish. Start with five minutes. Leave your phone in another room. Let the day find you when you are ready.\n\nThe practice is small, but the feeling can follow you long after breakfast.",
    image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1400&q=85",
    days: 1
  },
  {
    id: "story-rooms-that-breathe",
    title: "Rooms that leave a little room to breathe",
    category: "Design",
    excerpt: "A thoughtful home is less about what you add and more about what you let the light find.",
    body: "Good rooms do not ask for your attention all at once. They reveal themselves slowly: the grain of a wooden table, afternoon light crossing an uncluttered floor, a chair placed exactly where you want to sit.\n\nWhen a space feels crowded, the answer is not always another shelf. Try removing one thing. Let your most-used objects stay close and let the rest have a home beyond sight. The empty space left behind is not missing something. It is doing something.\n\nA home can be practical and poetic at the same time. Often, the quieter choice is the one you live with best.",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1400&q=85",
    days: 3
  },
  {
    id: "story-walking-without-destination",
    title: "A good walk doesn't need a destination",
    category: "Culture",
    excerpt: "On taking the long way home, following a side street, and seeing your own city again.",
    body: "Pick a direction, not a destination. Take the street you always pass and never turn down. Look above the shop signs. Notice which windows catch the sun and where the neighborhood gathers when work is done.\n\nWalking without a plan makes room for the kind of attention we rarely schedule. It returns familiar places to us as somewhere to explore, not just somewhere to get through.\n\nNext time the route is only ten minutes, give yourself twenty. You might be surprised by how much of a place was waiting just around the corner.",
    image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1400&q=85",
    days: 5
  },
  {
    id: "story-objects-with-stories",
    title: "The things we keep, and the stories they hold",
    category: "Living",
    excerpt: "An old bowl, a borrowed book, a postcard faded at the edges: everyday things are never just things.",
    body: "The chipped bowl still makes it to the table. The book with someone else's name inside has never been returned. None of these objects would make a list of essentials, and yet each one seems to know something about the life around it.\n\nWe keep things for their usefulness, but also for the moments that gather around them. A well-loved object is a kind of shorthand: touch it and you can remember a kitchen, a person, a particular year.\n\nMaybe keeping something is its own way of saying: this mattered, and I want to remember.",
    image: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1400&q=85",
    days: 8
  }
];
for (const story of stories) {
  const date = new Date(today - story.days * 86_400_000).toISOString();
  seed.run(story.id, demoAuthor, story.title, story.category, story.excerpt, story.body, story.image, date, date);
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
};
const cookie = (token, maxAge) =>
  `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const parseCookies = (header = "") =>
  Object.fromEntries(header.split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }));
const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error("Request body is too large"), { status: 413 });
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
};
const currentUser = (req) => {
  const token = parseCookies(req.headers.cookie).session;
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, new Date().toISOString());
  return row ?? null;
};
const requireUser = (req) => {
  const user = currentUser(req);
  if (!user) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
  return user;
};
const findPost = (id) => db.prepare(`
  SELECT posts.id, posts.author_id AS authorId, posts.title, posts.category, posts.excerpt,
    posts.body, posts.image, posts.created_at AS createdAt, posts.updated_at AS updatedAt,
    users.name AS author,
    (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS commentCount
  FROM posts JOIN users ON users.id = posts.author_id WHERE posts.id = ?
`).get(id);
const findComments = (id) => db.prepare(`
  SELECT comments.id, comments.body, comments.created_at AS createdAt, users.name AS author
  FROM comments JOIN users ON users.id = comments.author_id
  WHERE comments.post_id = ? ORDER BY comments.created_at ASC
`).all(id);
const validText = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
const clean = (value) => value.trim();

async function handleApi(req, res, url) {
  const method = req.method;
  const route = url.pathname;

  if (method === "GET" && route === "/api/me") {
    return json(res, 200, { user: currentUser(req) });
  }
  if (method === "POST" && route === "/api/register") {
    const { name, email, password } = await readBody(req);
    if (!validText(name, 2, 60) || !validText(email, 3, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: "Enter a valid name and email address." });
    }
    if (!validText(password, 10, 200)) {
      return json(res, 400, { error: "Your password must be at least 10 characters." });
    }
    const normalizedEmail = clean(email).toLowerCase();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail)) {
      return json(res, 409, { error: "An account with that email already exists." });
    }
    const id = randomBytes(16).toString("hex");
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    db.prepare("INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, clean(name), normalizedEmail, `${salt.toString("hex")}:${hash.toString("hex")}`, new Date().toISOString());
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, id, new Date(Date.now() + 30 * 86_400_000).toISOString());
    return json(res, 201, { user: { id, name: clean(name), email: normalizedEmail } }, {
      "Set-Cookie": cookie(token, 30 * 86_400)
    });
  }
  if (method === "POST" && route === "/api/login") {
    const { email, password } = await readBody(req);
    if (!validText(email, 3, 254) || typeof password !== "string") {
      return json(res, 400, { error: "Enter your email and password." });
    }
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(clean(email).toLowerCase());
    if (!user || !user.password_hash.includes(":")) {
      return json(res, 401, { error: "That email and password combination doesn't match." });
    }
    const [saltHex, hashHex] = user.password_hash.split(":");
    const candidate = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
    if (!timingSafeEqual(candidate, Buffer.from(hashHex, "hex"))) {
      return json(res, 401, { error: "That email and password combination doesn't match." });
    }
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, user.id, new Date(Date.now() + 30 * 86_400_000).toISOString());
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email } }, {
      "Set-Cookie": cookie(token, 30 * 86_400)
    });
  }
  if (method === "POST" && route === "/api/logout") {
    const token = parseCookies(req.headers.cookie).session;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return json(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
  }
  if (method === "GET" && route === "/api/posts") {
    const conditions = [];
    const values = [];
    const category = url.searchParams.get("category");
    const search = url.searchParams.get("search")?.trim();
    if (category && category !== "All stories") {
      conditions.push("posts.category = ?");
      values.push(category);
    }
    if (search) {
      conditions.push("(posts.title LIKE ? OR posts.excerpt LIKE ? OR posts.body LIKE ?)");
      values.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const posts = db.prepare(`
      SELECT posts.id, posts.author_id AS authorId, posts.title, posts.category, posts.excerpt,
        posts.body, posts.image, posts.created_at AS createdAt, posts.updated_at AS updatedAt,
        users.name AS author,
        (SELECT COUNT(*) FROM comments WHERE comments.post_id = posts.id) AS commentCount
      FROM posts JOIN users ON users.id = posts.author_id
      ${where} ORDER BY posts.created_at DESC
    `).all(...values);
    return json(res, 200, { posts });
  }
  const postMatch = route.match(/^\/api\/posts\/([a-zA-Z0-9-]+)$/);
  if (postMatch && method === "GET") {
    const post = findPost(postMatch[1]);
    return post ? json(res, 200, { post, comments: findComments(post.id) }) : json(res, 404, { error: "Story not found." });
  }
  if (method === "POST" && route === "/api/posts") {
    const user = requireUser(req);
    const input = await readBody(req);
    if (!validText(input.title, 5, 120) || !validText(input.category, 2, 30) ||
        !validText(input.excerpt, 20, 220) || !validText(input.body, 40, 20_000)) {
      return json(res, 400, { error: "Add a title, category, short introduction, and a story of at least 40 characters." });
    }
    const id = randomBytes(12).toString("hex");
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO posts (id, author_id, title, category, excerpt, body, image, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.id, clean(input.title), clean(input.category), clean(input.excerpt), clean(input.body),
      validText(input.image, 1, 500) ? clean(input.image) : "", now, now);
    return json(res, 201, { post: findPost(id) });
  }
  if (postMatch && method === "PUT") {
    const user = requireUser(req);
    const post = findPost(postMatch[1]);
    if (!post) return json(res, 404, { error: "Story not found." });
    if (post.authorId !== user.id) return json(res, 403, { error: "You can only edit your own stories." });
    const input = await readBody(req);
    if (!validText(input.title, 5, 120) || !validText(input.category, 2, 30) ||
        !validText(input.excerpt, 20, 220) || !validText(input.body, 40, 20_000)) {
      return json(res, 400, { error: "Add a title, category, short introduction, and a story of at least 40 characters." });
    }
    db.prepare(`
      UPDATE posts SET title = ?, category = ?, excerpt = ?, body = ?, image = ?, updated_at = ?
      WHERE id = ?
    `).run(clean(input.title), clean(input.category), clean(input.excerpt), clean(input.body),
      validText(input.image, 1, 500) ? clean(input.image) : "", new Date().toISOString(), post.id);
    return json(res, 200, { post: findPost(post.id) });
  }
  if (postMatch && method === "DELETE") {
    const user = requireUser(req);
    const post = findPost(postMatch[1]);
    if (!post) return json(res, 404, { error: "Story not found." });
    if (post.authorId !== user.id) return json(res, 403, { error: "You can only delete your own stories." });
    db.prepare("DELETE FROM posts WHERE id = ?").run(post.id);
    return json(res, 200, { ok: true });
  }
  const commentMatch = route.match(/^\/api\/posts\/([a-zA-Z0-9-]+)\/comments$/);
  if (commentMatch && method === "POST") {
    const user = requireUser(req);
    const post = findPost(commentMatch[1]);
    if (!post) return json(res, 404, { error: "Story not found." });
    const { body } = await readBody(req);
    if (!validText(body, 2, 1000)) return json(res, 400, { error: "Your comment must be between 2 and 1,000 characters." });
    const id = randomBytes(12).toString("hex");
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, post.id, user.id, clean(body), createdAt);
    return json(res, 201, { comment: { id, body: clean(body), createdAt, author: user.name } });
  }
  return json(res, 404, { error: "API route not found." });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: "Method not allowed." });
    }
    const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const path = normalize(join(publicDir, requested));
    if (!path.startsWith(`${publicDir}\\`) && path !== publicDir) {
      return json(res, 403, { error: "Forbidden." });
    }
    if (!existsSync(path)) return json(res, 404, { error: "Page not found." });
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(path)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    if (req.method === "HEAD") return res.end();
    return createReadStream(path).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const status = Number(error.status) || 500;
    if (status === 500) console.error(error);
    return json(res, status, { error: status === 500 ? "Something went wrong. Please try again." : error.message });
  }
}).listen(port, () => {
  console.log(`Fieldnotes is ready at http://localhost:${port}`);
});
