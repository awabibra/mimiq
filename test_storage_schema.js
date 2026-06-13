const { createClient } = require('@supabase/supabase-js');
// load env
const env = require('fs').readFileSync('/Users/awabibrah/MimiQ/.env.local', 'utf-8');
const anonKeyMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/);
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/);

async function test() {
  const supabase = createClient(urlMatch[1], anonKeyMatch[1]);
  // Just try to upload a dummy file to see the exact error
  // First login
  const { data: authData } = await supabase.auth.signUp({
    email: 'schema-test@example.com',
    password: 'password123'
  });
  const user = authData.user || (await supabase.auth.signInWithPassword({email: 'schema-test@example.com', password: 'password123'})).data.user;
  
  const { data, error } = await supabase.storage
    .from('project-files')
    .upload(`${user.id}/test-project/vocal/test.txt`, 'hello world', {
      contentType: 'text/plain',
      upsert: false,
    });
  console.log("Upload result:", error || data);
}

test();
