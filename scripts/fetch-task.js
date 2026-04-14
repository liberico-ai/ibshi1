async function main() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'toandv', password: '123456' })
  });
  const loginData = await loginRes.json();
  const token = loginData?.token;

  if (!token) {
    console.log("Login failed", loginData);
    return;
  }

  const listRes = await fetch('http://localhost:3000/api/projects', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const listData = await listRes.json();
  const proj = listData?.projects?.find(p => p.projectCode === 'DA-TEST-26-003');
  
  if (!proj) {
    console.log("Projects response:", Object.keys(listData), listData.projects?.length);
    console.log("Project not found in list!");
    return;
  }
  
  const projRes = await fetch(`http://localhost:3000/api/projects/${proj.id}?includeTasks=true`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const projData = await projRes.json();
  
  const project = projData?.project || projData?.data?.project;
  const tasksList = project?.tasks || [];
  
  const p11bTask = tasksList.find(t => t.stepCode === 'P1.1B');
  if (!p11bTask) {
    console.log('Task P1.1B not found in project response!');
    return;
  }
  
  console.log('Found Task ID:', p11bTask.id);

  const payload = {
    action: 'complete',
    notes: 'Completed'
  };

  const completeRes = await fetch(`http://localhost:3000/api/tasks/${p11bTask.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  
  const text = await completeRes.text();
  console.log("API Status:", completeRes.status);
  console.log("API Response:", text);
}
main();
