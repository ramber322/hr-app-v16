// src/lib/screening.js

// ✅ Moved here from BrowseJobsPage.jsx — adjust the URL if yours is different
const API_URL = 'http://localhost:8000'; // 👈 change to your actual Python API URL

// ✅ Moved here — the function screenPDSWithAPI calls
const detectJobCategory = (positionTitle) => {
  // ⚠️ COPY the exact body of this function from BrowseJobsPage.jsx
  // It's probably something like:
  const title = (positionTitle || '').toLowerCase();
  if (title.includes('admin')) return 'administrative';
  if (title.includes('it') || title.includes('information technology')) return 'it';
  // ... whatever else yours has ...
  return 'general';
};

// ✅ Moved here + exported
export const screenPDSWithAPI = async (pdsFile, job) => {
  let educationValue = job.qualifications?.education || 3;
  let experienceValue = job.qualifications?.workExperience || 1;
  let trainingValue = job.qualifications?.training || 4;
  const eligibilityValue = job.qualifications?.eligibility || "professional";

  if (educationValue === "None Required" || educationValue === "" || educationValue === null) {
    educationValue = 0;
  } else {
    educationValue = parseInt(educationValue) || 0;
  }

  if (experienceValue === "None Required" || experienceValue === "" || experienceValue === null) {
    experienceValue = 0;
  } else {
    experienceValue = parseInt(experienceValue) || 0;
  }

  if (trainingValue === "None Required" || trainingValue === "" || trainingValue === null) {
    trainingValue = 0;
  } else {
    trainingValue = parseInt(trainingValue) || 0;
  }

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

  console.log('📤 Sending to API:', {
    url: `${API_URL}/upload-pds?${params}`,
    education: educationValue,
    experience: experienceValue,
    training_hours: trainingValue,
    eligibility_level: eligibilityValue
  });

  try {
    const response = await fetch(`${API_URL}/upload-pds?${params}`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('📥 API Response:', result);
    return result;
    
  } catch (error) {
    console.error('❌ Error screening PDS:', error);
    throw error;
  }
};