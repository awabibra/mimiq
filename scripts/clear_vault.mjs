import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Fetching projects...");
  const { data: projects, error: fetchError } = await supabase
    .from('projects')
    .select('id, name, audio_assets, generated_chains');
  
  if (fetchError) {
    console.error("Error fetching:", fetchError);
    return;
  }

  for (const project of projects) {
    console.log(`Clearing vault for project: ${project.name} (${project.id})`);
    
    // Also delete any stored audio assets in the storage bucket 'project_audio' to free up space
    // Optional, but good to do if there are loads of zip files
    if (project.audio_assets && project.audio_assets.length > 0) {
      const pathsToDelete = project.audio_assets
        .map(a => a.storage_path)
        .filter(Boolean);
        
      if (pathsToDelete.length > 0) {
        console.log(`Deleting ${pathsToDelete.length} files from storage for project ${project.id}...`);
        const { error: storageError } = await supabase
          .storage
          .from('project_audio')
          .remove(pathsToDelete);
        
        if (storageError) {
          console.error(`Failed to delete storage for ${project.id}:`, storageError);
        }
      }
    }

    const { error: updateError } = await supabase
      .from('projects')
      .update({
        audio_assets: [],
        generated_chains: []
      })
      .eq('id', project.id);
      
    if (updateError) {
      console.error(`Failed to update project ${project.id}:`, updateError);
    } else {
      console.log(`Successfully cleared vault for project ${project.id}.`);
    }
  }
}

main().catch(console.error);
