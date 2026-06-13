const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('/Users/awabibrah/MimiQ/.env.local', 'utf-8');
const anonKeyMatch = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/);
const urlMatch = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/);
const serviceRoleMatch = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);

async function test() {
  const supabaseAdmin = createClient(urlMatch[1], serviceRoleMatch[1]);
  
  // create user
  const { data: userAdminData, error: userAdminErr } = await supabaseAdmin.auth.admin.createUser({
    email: 'schema-test2@example.com',
    password: 'password123',
    email_confirm: true
  });
  
  let userId;
  if (userAdminErr) {
    // maybe user exists
    const users = await supabaseAdmin.auth.admin.listUsers();
    userId = users.data.users.find(u => u.email === 'schema-test2@example.com')?.id;
  } else {
    userId = userAdminData.user.id;
  }

  const supabase = createClient(urlMatch[1], anonKeyMatch[1]);
  await supabase.auth.signInWithPassword({email: 'schema-test2@example.com', password: 'password123'});

  const fileData = fs.readFileSync('/Users/awabibrah/MimiQ/crazz.mp3');

  const { data, error } = await supabase.storage
    .from('project-files')
    .upload(`${userId}/test-project/vocal/test.mp3`, fileData, {
      contentType: 'audio/mpeg',
      upsert: true,
    });
    
  console.log("Upload result with anon client:", error || data);
  
  // Let's test with empty type
  const { data: d2, error: e2 } = await supabase.storage
    .from('project-files')
    .upload(`${userId}/test-project/vocal/test_empty.mp3`, fileData, {
      contentType: '',
      upsert: true,
    });
  console.log("Upload result with empty type:", e2 || d2);
}

test();
