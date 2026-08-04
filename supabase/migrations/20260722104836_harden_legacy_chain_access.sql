ALTER FUNCTION public.handle_updated_at() SET search_path = public;

ALTER TABLE public.chains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own chains" ON public.chains;
CREATE POLICY "Users can read own chains"
  ON public.chains
  FOR SELECT
  TO authenticated
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can create own chains" ON public.chains;
CREATE POLICY "Users can create own chains"
  ON public.chains
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own chains" ON public.chains;
CREATE POLICY "Users can update own chains"
  ON public.chains
  FOR UPDATE
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete own chains" ON public.chains;
CREATE POLICY "Users can delete own chains"
  ON public.chains
  FOR DELETE
  TO authenticated
  USING (auth.uid()::text = user_id);

REVOKE ALL ON TABLE public.chains FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chains TO authenticated;
