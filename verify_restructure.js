require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/db');

async function testAll() {
  let server;
  const port = await new Promise((resolve) => {
    server = app.listen(0, () => {
      resolve(server.address().port);
    });
  });

  const baseUrl = `http://localhost:${port}`;
  console.log(`Verification server running on ${baseUrl}`);

  try {
    // Helper helper for request options
    const jsonReq = (method, body, token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      return {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      };
    };

    // 1. Super Admin Login
    console.log('Testing Login...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, jsonReq('POST', {
      email: 'superadmin@example.com',
      password: 'superadmin123'
    }));
    const loginData = await loginRes.json();
    if (loginRes.status !== 200 || !loginData.success) throw new Error('Login failed');
    const saToken = loginData.token;
    console.log('✅ Login successful');

    // 2. Super Admin Dashboard
    console.log('Testing Super Admin Dashboard...');
    const saDashRes = await fetch(`${baseUrl}/api/super-admin/dashboard`, jsonReq('GET', null, saToken));
    const saDashData = await saDashRes.json();
    if (saDashRes.status !== 200 || !saDashData.success) throw new Error('Super Admin Dashboard failed');
    console.log('✅ Super Admin Dashboard works');

    // 3. Create Company
    console.log('Testing Create Company...');
    const newEmail = `owner_${Date.now()}@example.com`;
    const createCoRes = await fetch(`${baseUrl}/api/super-admin/companies`, jsonReq('POST', {
      companyName: 'Restructured Corp',
      ownerName: 'Alice Tester',
      email: newEmail,
      password: 'companypass123',
      industry: 'Software'
    }, saToken));
    const createCoData = await createCoRes.json();
    if (createCoRes.status !== 201 || !createCoData.success) throw new Error('Company creation failed');
    console.log('✅ Company created');

    // 4. Company Login
    console.log('Testing Company Admin Login...');
    const coLoginRes = await fetch(`${baseUrl}/api/login`, jsonReq('POST', {
      email: newEmail,
      password: 'companypass123'
    }));
    const coLoginData = await coLoginRes.json();
    if (coLoginRes.status !== 200 || !coLoginData.success) throw new Error('Company Login failed');
    const coToken = coLoginData.token;
    console.log('✅ Company Login successful');

    // 5. Company Dashboard
    console.log('Testing Company Dashboard...');
    const coDashRes = await fetch(`${baseUrl}/api/company/dashboard`, jsonReq('GET', null, coToken));
    const coDashData = await coDashRes.json();
    if (coDashRes.status !== 200 || !coDashData.success) throw new Error('Company Dashboard failed');
    console.log('✅ Company Dashboard works');

    // 6. Company Profile
    console.log('Testing Company Profile...');
    const profileRes = await fetch(`${baseUrl}/api/company/profile`, jsonReq('GET', null, coToken));
    const profileData = await profileRes.json();
    if (profileRes.status !== 200 || !profileData.success) throw new Error('Company Profile failed');
    console.log('✅ Company Profile retrieval works');

    // 7. Create Project
    console.log('Testing Projects API (Create & List)...');
    const projRes = await fetch(`${baseUrl}/api/company/projects`, jsonReq('POST', { name: 'Portal Redesign' }, coToken));
    const projData = await projRes.json();
    if (projRes.status !== 201 || !projData.success) throw new Error('Project creation failed');
    const projId = projData.data.id;

    const listProjRes = await fetch(`${baseUrl}/api/company/projects`, jsonReq('GET', null, coToken));
    const listProjData = await listProjRes.json();
    if (listProjRes.status !== 200 || listProjData.data.length === 0) throw new Error('Listing projects failed');
    console.log('✅ Projects API works');

    // 8. Create Team
    console.log('Testing Teams API (Create & List)...');
    const teamRes = await fetch(`${baseUrl}/api/company/teams`, jsonReq('POST', { name: 'Design Team' }, coToken));
    const teamData = await teamRes.json();
    if (teamRes.status !== 201 || !teamData.success) throw new Error('Team creation failed');
    
    const listTeamRes = await fetch(`${baseUrl}/api/company/teams`, jsonReq('GET', null, coToken));
    const listTeamData = await listTeamRes.json();
    if (listTeamRes.status !== 200 || listTeamData.data.length === 0) throw new Error('Listing teams failed');
    console.log('✅ Teams API works');

    // 9. Employees
    console.log('Testing Employees API...');
    const listEmpRes = await fetch(`${baseUrl}/api/company/employees`, jsonReq('GET', null, coToken));
    const listEmpData = await listEmpRes.json();
    if (listEmpRes.status !== 200 || !listEmpData.success) throw new Error('Listing employees failed');
    console.log('✅ Employees API works');

    // 10. Clients
    console.log('Testing Clients API (Create & List)...');
    const clientRes = await fetch(`${baseUrl}/api/company/clients`, jsonReq('POST', {
      name: 'Client Corp',
      email: `client_${Date.now()}@example.com`,
      password: 'clientpass123'
    }, coToken));
    const clientData = await clientRes.json();
    if (clientRes.status !== 201 || !clientData.success) throw new Error('Client creation failed');

    const listClientRes = await fetch(`${baseUrl}/api/company/clients`, jsonReq('GET', null, coToken));
    const listClientData = await listClientRes.json();
    if (listClientRes.status !== 200 || !listClientData.success) throw new Error('Listing clients failed');
    console.log('✅ Clients API works');

    // 11. Tasks
    console.log('Testing Tasks API (Create & List)...');
    const taskRes = await fetch(`${baseUrl}/api/company/tasks`, jsonReq('POST', {
      title: 'Design UI mockup',
      projectId: projId
    }, coToken));
    const taskData = await taskRes.json();
    if (taskRes.status !== 201 || !taskData.success) throw new Error('Task creation failed');

    const listTaskRes = await fetch(`${baseUrl}/api/company/tasks`, jsonReq('GET', null, coToken));
    const listTaskData = await listTaskRes.json();
    if (listTaskRes.status !== 200 || !listTaskData.success) throw new Error('Listing tasks failed');
    console.log('✅ Tasks API works');

    // 12. Reports
    console.log('Testing Reports API...');
    const reportRes = await fetch(`${baseUrl}/api/company/reports/summary`, jsonReq('GET', null, coToken));
    const reportData = await reportRes.json();
    if (reportRes.status !== 200 || !reportData.success) throw new Error('Reports summary failed');
    console.log('✅ Reports API works');

    console.log('\n🌟 ALL RESTUCTURED APIS FUNCTION PERFECTLY! 🌟');

  } catch (error) {
    console.error('\n❌ RESTRUCTURE VERIFICATION FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    server.close(() => {
      console.log('Verification server closed.');
      pool.end(() => {
        console.log('DB pool closed.');
      });
    });
  }
}

testAll();
