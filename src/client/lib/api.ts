import type { Post, PostPatch } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  listPosts: () => fetch("/api/posts").then(json<Post[]>),
  getPost: (id: number) => fetch(`/api/posts/${id}`).then(json<Post>),
  createPost: (title?: string) =>
    fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(json<Post>),
  updatePost: (id: number, patch: PostPatch) =>
    fetch(`/api/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json<Post>),
  deletePost: (id: number) =>
    fetch(`/api/posts/${id}`, { method: "DELETE" }).then(json<{ ok: true }>),
  uploadImage: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    return json<{ url: string; filename: string }>(res);
  },
};
