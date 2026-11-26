-- Scope community_posts, comments, and post_likes SELECT policies to the owning user.

DROP POLICY IF EXISTS "community authenticated select" ON public.community_posts;
CREATE POLICY "community own select"
  ON public.community_posts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "comments authenticated select" ON public.comments;
CREATE POLICY "comments own select"
  ON public.comments
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "likes authenticated select" ON public.post_likes;
CREATE POLICY "likes own select"
  ON public.post_likes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);