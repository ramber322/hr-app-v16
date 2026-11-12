import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/logActivity';

// ── Copy these two constants/functions from your BrowseJobsPage ──
// (If your API_URL is different, change it here)
const API_URL = 'http://localhost:8000'; 

const detectJobCategory = (positionTitle) => {
  const title = (positionTitle || '').toLowerCase();
  if (title.includes('admin')) return 'administrative';
  if (title.includes('it') || title.includes('information technology')) return 'it';
  // ⚠️ PASTE YOUR REAL LOGIC HERE
  return 'general';
};

// ── Self-contained screening function ──
const screenPDSWithAPI = async (pdsFile, job) => {
  // ✅ Read from flat DB columns
let educationValue       = job.required_education ?? 0;
let experienceValue      = job.required_work_experience ?? 0;
let trainingValue        = job.required_training ?? 0;
const eligibilityValue   = job.required_eligibility ?? "none";

  if (educationValue === "None Required" || educationValue === "" || educationValue === null) educationValue = 0;
  else educationValue = parseInt(educationValue) || 0;

  if (experienceValue === "None Required" || experienceValue === "" || experienceValue === null) experienceValue = 0;
  else experienceValue = parseInt(experienceValue) || 0;

  if (trainingValue === "None Required" || trainingValue === "" || trainingValue === null) trainingValue = 0;
  else trainingValue = parseInt(trainingValue) || 0;

  const formData = new FormData();
  formData.append('file', pdsFile);

  const params = new URLSearchParams({
    position_title: job.position_title || "Position",
    job_category: detectJobCategory(job.position_title),
    education: educationValue,
    experience: experienceValue,
    training_hours: trainingValue,
    eligibility_level: eligibilityValue
  });

  const response = await fetch(`${API_URL}/upload-pds?${params}`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  return await response.json();
};

// ── Main Re-assessment Function ──
export async function reassessApplication({ application, newFile }) {
  // 1. Load the job
  const { data: job, error: jobError } = await supabase
    .from('job_postings')
    .select('*')
    .eq('id', application.job_id)
    .single();

  if (jobError) throw new Error(`Could not load job: ${jobError.message}`);

  // 2. Upload new PDS to Storage (creates a new file, doesn't delete the old one)
  const ext = newFile.name.split('.').pop();
  const filePath = `${application.job_id}/${application.applicant_id}/pds-${Date.now()}.${ext}`;

const { error: uploadError } = await supabase.storage
  .from('applicant_docs')
  .upload(filePath, newFile, { upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from('applicant-documents')
    .getPublicUrl(filePath);

  // 3. Re-screen
  const screeningResult = await screenPDSWithAPI(newFile, job);
  if (!screeningResult.success) {
    throw new Error(screeningResult.error || 'Screening failed');
  }

  // 4. Apply the same -3.2 to -3.4 disguise cap
  const rawScore = screeningResult.fit_analysis?.percentage || 0;
  const penalty = 3.2 + (Math.random() * 0.2);
  const adjustedScore = Math.max(0, Number((rawScore - penalty).toFixed(2)));

  // 5. Preserve old score history
  const oldScore = application.ai_match_score;
  const previousScores = [
    ...(application.ai_explanation?.previous_scores || []),
    { score: oldScore, at: new Date().toISOString() }
  ];

  // 6. UPDATE the existing application row (keeps the same application ID)
  const { error: updateError } = await supabase
    .from('applications')
    .update({
      ai_match_score: adjustedScore,
      ai_explanation: {
        verdict: screeningResult.fit_analysis?.verdict || 'NOT FIT',
        breakdown: screeningResult.fit_analysis?.breakdown || {},
        requirements_met: screeningResult.fit_analysis?.requirements_met || '0/0',
        score: adjustedScore,
        binary_percentage: screeningResult.fit_analysis?.binary_percentage || 0,
        summary: screeningResult.explanation?.summary || '',
        feature_breakdown: screeningResult.explanation?.feature_breakdown || [],
        recommendations: screeningResult.explanation?.recommendations || [],
        verdict_description: screeningResult.explanation?.verdict_description || '',
        previous_scores: previousScores
      },
      doc_filenames: {
        ...(application.doc_filenames || {}),
        pds: publicUrl
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', application.id);

  if (updateError) throw new Error(`Update failed: ${updateError.message}`);

  // 7. Log the action for the superadmin
  await logActivity(
    'status_update',
    `Re-assessed PDS for "${job.position_title}" — score ${oldScore}% → ${adjustedScore}%`,
    { job_id: application.job_id, metadata: { application_id: application.id } }
  );

  // 8. Return the new score to the UI
  return {
    oldScore,
    newScore: adjustedScore,
    jobTitle: job.position_title
  };
}