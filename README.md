# Fieldnotes

A small, self-contained blog platform with a responsive editorial UI, account registration and login, author-managed posts, comments, and a SQLite-backed REST API. It uses Node.js built-ins only.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). Set `PORT` to use a different port. SQLite data is stored in `data/blog.sqlite`; the starter stories are inserted automatically the first time the server starts.

## API

- `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/posts?category=Design&search=light`, `GET /api/posts/:id`
- `POST /api/posts`, `PUT /api/posts/:id`, `DELETE /api/posts/:id`
- `POST /api/posts/:id/comments`

Creating or editing posts, deleting your own posts, and commenting require an authenticated account.
