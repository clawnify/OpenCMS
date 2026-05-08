export type PostStatus = "draft" | "live";

export interface Post {
  id: number;
  title: string;
  slug: string;
  description: string;
  content: string;
  image_url: string | null;
  status: PostStatus;
  featured: number;
  category: string;
  author: string;
  post_date: string;
  created_at: string;
  updated_at: string;
}

export type PostPatch = Partial<Omit<Post, "id" | "created_at" | "updated_at">>;
