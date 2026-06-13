CREATE TABLE IF NOT EXISTS public.era_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL UNIQUE,
    engineers text[] DEFAULT '{}',
    track_count integer NOT NULL DEFAULT 0,
    metrics jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.era_profiles ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users (and possibly public if needed)
CREATE POLICY "Enable read access for all users" ON public.era_profiles
    FOR SELECT
    USING (true);

-- Allow insert/update for service role only, or specific admins. 
-- Since the Python script uses the service_role key, it will bypass RLS.
CREATE POLICY "Enable insert for service role only" ON public.era_profiles
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Enable update for service role only" ON public.era_profiles
    FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Create a trigger to automatically update the 'updated_at' column
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER era_profiles_updated_at
    BEFORE UPDATE ON public.era_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
