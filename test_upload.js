require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function testUpload() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  
  // Sign in or create a test user
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: 'test@example.com',
    password: 'password123'
  });
  
  const user = authData.user || (await supabase.auth.signInWithPassword({email: 'test@example.com', password: 'password123'})).data.user;
  
  if (!user) {
    console.error("Failed to sign in:", authErr);
    return;
  }
  
  const fileData = fs.readFileSync('/Users/awabibrah/MimiQ/crazz.mp3');
  const path = `${user.id}/test-project/vocal/test.mp3`;

  // We are uploading directly like the browser would
  const { data, error } = await supabase.storage
    .from('project-files')
    .upload(path, fileData, {
      contentType: 'audio/mpeg',
      upsert: false,
    });
    
  if (error) {
    console.error("Upload error:", error);
  } else {
    console.log("Upload success:", data);
  }
}

testUpload();
