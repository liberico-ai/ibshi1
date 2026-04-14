import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const t = await prisma.workflowTask.findFirst({
    where: { stepCode: 'P1.1B', project: { projectCode: 'DA-TEST-26-003' } }
  })
  if (!t) {
    console.log("No Task found!")
    return
  }
  console.log("Task ID:", t.id)
  
  // Fake payload like the frontend sends:
  const payload = {
    action: 'complete',
    notes: 'Completed'
  }

  const res = await fetch(`http://localhost:3000/api/tasks/${t.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify(payload)
  })
  
  // Wait, if we fetch without auth, it will return 401 Unauthorized because of `authenticateRequest(req)`.
  // Let's get a token first.
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'toandv', password: 'password123' })
  })
  const loginData = await loginRes.json()
  const token = loginData?.data?.token
  if (!token) {
     console.log('Login failed', loginData)
     return
  }

  const completeRes = await fetch(`http://localhost:3000/api/tasks/${t.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  })
  
  const text = await completeRes.text()
  console.log("API Status:", completeRes.status)
  console.log("API Response:", text)
}

main().finally(() => prisma.$disconnect())
