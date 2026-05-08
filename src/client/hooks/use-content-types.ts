import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type { ContentType } from "@/lib/content-types";

export function useContentTypes() {
  const [list, setList] = useState<ContentType[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fresh = await api.listContentTypes();
      setList(fresh);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { list, loading, refresh, setList };
}
