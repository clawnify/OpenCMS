import { useEffect, useState, useCallback } from "react";
import { Plus, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Sidebar } from "./components/sidebar";
import { PostsTable } from "./components/posts-table";
import { PostEditor } from "./components/post-editor";
import { useRouter, matchPostRoute } from "./hooks/use-router";
import { api } from "./lib/api";
import type { Post } from "./lib/types";

export function App() {
  const { path, navigate } = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [active, setActive] = useState<Post | null>(null);

  const selectedId = matchPostRoute(path);

  const load = useCallback(async () => {
    const list = await api.listPosts();
    setPosts(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedId == null) {
      setActive(null);
      return;
    }
    const cached = posts.find((p) => p.id === selectedId);
    if (cached) {
      setActive(cached);
      return;
    }
    api.getPost(selectedId).then(setActive).catch(() => navigate("/"));
  }, [selectedId, posts, navigate]);

  async function createPost() {
    const post = await api.createPost();
    setPosts((p) => [post, ...p]);
    navigate(`/posts/${post.id}`);
  }

  function onPostChange(updated: Post) {
    setPosts((list) => list.map((p) => (p.id === updated.id ? updated : p)));
    setActive(updated);
  }

  async function patchPost(id: number, patch: import("./lib/types").PostPatch) {
    setPosts((list) =>
      list.map((p) => (p.id === id ? ({ ...p, ...patch } as Post) : p)),
    );
    try {
      const saved = await api.updatePost(id, patch);
      onPostChange(saved);
    } catch (err) {
      console.error(err);
      load();
    }
  }

  async function onDelete() {
    if (!active) return;
    if (!window.confirm(`Delete "${active.title}"?`)) return;
    await api.deletePost(active.id);
    setPosts((list) => list.filter((p) => p.id !== active.id));
    navigate("/");
  }

  const collections = [{ id: "posts", label: "Posts", count: posts.length }];

  return (
    <div className="h-screen flex bg-background text-foreground overflow-hidden">
      <Sidebar collections={collections} activeId="posts" onSelect={() => navigate("/")} />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 h-10 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={createPost}
            className="h-7 w-7 p-0"
            title="New post"
          >
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Filter">
            <Filter className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Search">
            <Search className="size-4" />
          </Button>
        </div>
        <PostsTable
          posts={posts}
          onOpen={(id) => navigate(`/posts/${id}`)}
          onPatch={patchPost}
          selectedId={selectedId}
        />
      </main>

      <Sheet
        open={!!active}
        onOpenChange={(open) => {
          if (!open) navigate("/");
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          overlayClassName="bg-white/40 backdrop-blur-none supports-backdrop-filter:backdrop-blur-none"
          className="w-full sm:max-w-[80vw] lg:max-w-[1200px] p-0 gap-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {active && (
            <PostEditor
              key={active.id}
              post={active}
              onChange={onPostChange}
              onClose={() => navigate("/")}
              onDelete={onDelete}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
