const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const t = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P1.1B', project: { projectCode: 'DA-TEST-26-003' } }
  });
  if (!t) {
    console.log("No Task found!");
    return;
  }
  console.log("Task ID:", t.id);

  // Authenticate as toandv to get a token
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'toandv', password: 'password123' }) // Assuming default pass
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.log("Login failed:", loginData);
    return;
  }
  const token = loginData.data?.token;

  // Simulate completeTask
  const completeRes = await fetch(`http://localhost:3000/api/tasks/${t.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ action: 'complete', notes: 'Completed' })
  });
  
  const text = await completeRes.text();
  console.log("Status:", completeRes.status);
  console.log("Response:", text);
}
main().finally(() => prisma.$disconnect());
