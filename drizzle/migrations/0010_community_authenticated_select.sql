-- Restrict community_posts, comments, and post_likes SELECT access to authenticated users only.

REVOKE SELECT ON public.community_posts FROM anon;
REVOKE SELECT ON public.comments FROM anon;
REVOKE SELECT ON public.post_likes FROM anon;

GRANT SELECT ON public.community_posts TO authenticated;
GRANT SELECT ON public.comments TO authenticated;
GRANT SELECT ON public.post_likes TO authenticated;

DROP POLICY IF EXISTS "community public select" ON public.community_posts;
CREATE POLICY "community authenticated select"
  ON public.community_posts
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "comments public select" ON public.comments;
CREATE POLICY "comments authenticated select"
  ON public.comments
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "likes public select" ON public.post_likes;
CREATE POLICY "likes authenticated select"
  ON public.post_likes
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);