const categories = ["All stories", "Wellbeing", "Design", "Culture", "Living", "Notes"];
const state = { posts: [], category: "All stories", search: "", user: null, activePost: null, authMode: "register" };
const $ = (selector, root = document) => root.querySelector(selector);
const featuredCard = $("#featured-card");
const storyGrid = $("#story-grid");
const toast = $("#toast");
const authDialog = $("#auth-dialog");
const storyDialog = $("#story-dialog");
const articleDialog = $("#article-dialog");
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    credentials: "same-origin"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formattedDate(value, options = { month: "long", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en", options).format(new Date(value));
}

function renderCategories() {
  const container = $("#category-list");
  container.replaceChildren();
  categories.forEach((category) => {
    const button = makeElement("button", `category-button${state.category === category ? " active" : ""}`, category);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.category === category));
    button.addEventListener("click", () => {
      state.category = category;
      renderCategories();
      loadPosts();
    });
    container.append(button);
  });
}

function renderFeatured(post) {
  featuredCard.replaceChildren();
  if (!post) {
    featuredCard.hidden = true;
    return;
  }
  featuredCard.hidden = false;
  const copy = makeElement("div", "featured-copy");
  copy.append(makeElement("span", "category-tag", post.category));
  copy.append(makeElement("h3", "", post.title));
  copy.append(makeElement("p", "", post.excerpt));

  const meta = makeElement("div", "story-meta");
  meta.append(makeElement("span", "meta-avatar", post.author.slice(0, 1).toUpperCase()));
  meta.append(makeElement("span", "", post.author));
  meta.append(makeElement("span", "meta-separator", "·"));
  meta.append(makeElement("span", "", `${Math.max(1, Math.ceil(post.body.split(/\s+/).length / 200))} min read`));
  copy.append(meta);

  const read = makeElement("button", "read-feature");
  read.type = "button";
  read.append(document.createTextNode("Read the story "), makeElement("span", "", "→"));
  read.addEventListener("click", () => openPost(post.id));
  copy.append(read);

  const image = makeElement("div", "featured-image");
  if (post.image) image.style.backgroundImage = `url("${post.image.replaceAll('"', "%22")}")`;
  featuredCard.append(copy, image);
}

function makeStoryCard(post) {
  const card = makeElement("article", "story-card");
  const image = makeElement("button", "story-card-image");
  image.type = "button";
  image.setAttribute("aria-label", `Read ${post.title}`);
  if (post.image) image.style.backgroundImage = `url("${post.image.replaceAll('"', "%22")}")`;
  image.addEventListener("click", () => openPost(post.id));

  const copy = makeElement("div", "story-card-copy");
  copy.append(makeElement("span", "category-tag", post.category));
  copy.append(makeElement("h3", "", post.title));
  copy.append(makeElement("p", "", post.excerpt));
  const meta = makeElement("div", "card-meta");
  meta.append(makeElement("span", "", `${post.author} · ${formattedDate(post.createdAt, { month: "short", day: "numeric" })}`));
  const comments = makeElement("span", "card-comment", `○ ${post.commentCount}`);
  meta.append(comments);
  copy.append(meta);

  if (state.user?.id === post.authorId) {
    const actions = makeElement("div", "card-actions");
    const edit = makeElement("button", "", "Edit story");
    edit.type = "button";
    edit.addEventListener("click", () => openStoryEditor(post));
    const remove = makeElement("button", "", "Delete");
    remove.type = "button";
    remove.addEventListener("click", () => deletePost(post.id));
    actions.append(edit, remove);
    copy.append(actions);
  }
  card.append(image, copy);
  return card;
}

async function loadPosts() {
  const params = new URLSearchParams();
  if (state.category !== "All stories") params.set("category", state.category);
  if (state.search) params.set("search", state.search);
  try {
    const { posts } = await api(`/api/posts${params.size ? `?${params}` : ""}`);
    state.posts = posts;
    storyGrid.replaceChildren(...posts.map(makeStoryCard));
    $("#empty-state").hidden = posts.length !== 0;
    const featured = state.category === "All stories" && !state.search
      ? posts[0]
      : posts.find((post) => post.id === state.posts[0]?.id);
    renderFeatured(featured ?? posts[0]);
  } catch (error) {
    showToast(error.message);
  }
}

function updateAccount() {
  $("#account-actions").hidden = Boolean(state.user);
  $("#account-menu").hidden = !state.user;
  $("#account-name").textContent = state.user ? `Hello, ${state.user.name}` : "";
}

function setAuthMode(mode) {
  state.authMode = mode;
  const login = mode === "login";
  $("#name-field").hidden = login;
  $("#name-field input").required = !login;
  $("#auth-form [name=password]").autocomplete = login ? "current-password" : "new-password";
  $("#auth-form [name=password]").minLength = login ? 1 : 8;
  $("#auth-title").textContent = login ? "Welcome back." : "Welcome to the journal.";
  $("#auth-description").textContent = login
    ? "Good to have you back. Pick up where you left off."
    : "Join a thoughtful community of curious minds.";
  $("#auth-submit").innerHTML = login ? 'Log in to your account <span aria-hidden="true">↗</span>' : 'Create your account <span aria-hidden="true">↗</span>';
  $("#auth-switch").hidden = false;
  $("#auth-switch").querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  $("#auth-error").textContent = "";
}

function openAuth(mode = "register") {
  setAuthMode(mode);
  authDialog.showModal();
}

function openStoryEditor(post) {
  if (!state.user) {
    openAuth("login");
    return;
  }
  const form = $("#story-form");
  form.reset();
  form.dataset.postId = post?.id ?? "";
  $("#story-dialog-title").textContent = post ? "Edit your story." : "Write a story.";
  $("#story-error").textContent = "";
  const submit = form.querySelector('[type="submit"]');
  submit.innerHTML = post ? 'Save your changes <span aria-hidden="true">↗</span>' : 'Publish your story <span aria-hidden="true">↗</span>';
  if (post) {
    for (const [field, value] of Object.entries(post)) {
      const input = form.elements.namedItem(field);
      if (input) input.value = value;
    }
  }
  storyDialog.showModal();
}

function safeImage(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, window.location.origin);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function renderComments(comments) {
  const list = makeElement("div", "comments-list");
  if (!comments.length) {
    list.append(makeElement("p", "comments-signin", "No notes yet. Be the first to share a thought."));
  }
  comments.forEach((comment) => {
    const item = makeElement("div", "comment-item");
    const heading = makeElement("div");
    heading.append(makeElement("span", "comment-author", comment.author));
    heading.append(makeElement("span", "comment-date", formattedDate(comment.createdAt)));
    item.append(heading, makeElement("p", "", comment.body));
    list.append(item);
  });
  return list;
}

async function openPost(id) {
  try {
    const { post, comments } = await api(`/api/posts/${encodeURIComponent(id)}`);
    state.activePost = post;
    const article = $("#article-content");
    article.replaceChildren();
    const image = makeElement("div", "article-image");
    const imageUrl = safeImage(post.image);
    if (imageUrl) image.style.backgroundImage = `url("${imageUrl.replaceAll('"', "%22")}")`;
    const content = makeElement("div");
    content.append(makeElement("span", "category-tag", post.category));
    content.append(makeElement("h2", "", post.title));
    content.append(makeElement("p", "article-excerpt", post.excerpt));
    const meta = makeElement("p", "card-meta", `${post.author} · ${formattedDate(post.createdAt)}`);
    content.append(meta);
    const body = makeElement("div", "article-body");
    post.body.split(/\n{2,}/).filter(Boolean).forEach((paragraph) => body.append(makeElement("p", "", paragraph)));
    content.append(body, makeElement("hr", "article-divider"), makeElement("h3", "comments-heading", `A little conversation (${comments.length})`));
    content.append(renderComments(comments));

    if (state.user) {
      const form = makeElement("form", "comment-form");
      const input = makeElement("input");
      input.name = "body";
      input.required = true;
      input.minLength = 2;
      input.maxLength = 1000;
      input.placeholder = "Leave a thoughtful note...";
      input.setAttribute("aria-label", "Your comment");
      const button = makeElement("button", "", "Add a note");
      button.type = "submit";
      form.append(input, button);
      form.addEventListener("submit", (event) => submitComment(event, form, post.id));
      content.append(form);
    } else {
      const signIn = makeElement("p", "comments-signin");
      signIn.append(document.createTextNode("Want to join the conversation? "));
      const button = makeElement("button", "", "Sign in");
      button.type = "button";
      button.addEventListener("click", () => {
        articleDialog.close();
        openAuth("login");
      });
      signIn.append(button);
      content.append(signIn);
    }
    article.append(image, content);
    $("#article-dialog").setAttribute("aria-labelledby", "article-title");
    const title = content.querySelector("h2");
    title.id = "article-title";
    if (!articleDialog.open) articleDialog.showModal();
  } catch (error) {
    showToast(error.message);
  }
}

async function submitComment(event, form, postId) {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await api(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: form.elements.body.value })
    });
    await openPost(postId);
    await loadPosts();
    showToast("Your note has been added.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function deletePost(id) {
  if (!window.confirm("Delete this story? This also removes its comments.")) return;
  try {
    await api(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadPosts();
    showToast("Your story has been deleted.");
  } catch (error) {
    showToast(error.message);
  }
}

$("#login-button").addEventListener("click", () => openAuth("login"));
$("#join-button").addEventListener("click", () => openAuth("register"));
$("#write-button").addEventListener("click", () => openStoryEditor());
$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    updateAccount();
    await loadPosts();
    showToast("You have been logged out.");
  } catch (error) {
    showToast(error.message);
  }
});
document.querySelectorAll(".dialog-close").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});
document.querySelectorAll(".app-dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
$("#auth-switch").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) setAuthMode(button.dataset.mode);
});
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  $("#auth-error").textContent = "";
  const submit = $("#auth-submit");
  submit.disabled = true;
  try {
    const { user } = await api(state.authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify(data)
    });
    state.user = user;
    updateAccount();
    authDialog.close();
    form.reset();
    await loadPosts();
    showToast(state.authMode === "register" ? "Welcome to Fieldnotes." : "Welcome back.");
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
$("#story-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const postId = form.dataset.postId;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  $("#story-error").textContent = "";
  try {
    await api(postId ? `/api/posts/${encodeURIComponent(postId)}` : "/api/posts", {
      method: postId ? "PUT" : "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    storyDialog.close();
    await loadPosts();
    showToast(postId ? "Your story has been updated." : "Your story is out in the world.");
  } catch (error) {
    $("#story-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
let searchTimer;
$("#search-input").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = event.target.value.trim();
    loadPosts();
  }, 180);
});
$("#search-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    clearTimeout(searchTimer);
    state.search = event.currentTarget.value.trim();
    loadPosts();
  }
});

async function init() {
  renderCategories();
  try {
    const { user } = await api("/api/me");
    state.user = user;
    updateAccount();
    await loadPosts();
  } catch (error) {
    showToast(error.message);
  }
}
init();
