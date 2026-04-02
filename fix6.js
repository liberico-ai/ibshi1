const fs = require('fs');

let content = fs.readFileSync('src/app/dashboard/tasks/[id]/page.tsx', 'utf8');

// Fix 1: React.useState -> useState in renderWbsTableUI
content = content.replace('const [wbsModalOpen, setWbsModalOpen] = React.useState(false);', 'const [wbsModalOpen, setWbsModalOpen] = useState(false);');

// Fix 2: Revert the invalid P2.4 || P1.2A replacement
content = content.replaceAll("{(task.stepCode === 'P2.4' || task.stepCode === 'P1.2A') && renderEstTable(", "{(task.stepCode === 'P2.4') && renderEstTable(");
content = content.replaceAll("{(task.stepCode === 'P2.1A' || task.stepCode === 'P2.4' || task.stepCode === 'P1.2A') && renderEstTable(", "{(task.stepCode === 'P2.1A' || task.stepCode === 'P2.4') && renderEstTable(");

// Check if there's any left that I missed
content = content.replaceAll("task.stepCode === 'P2.4' || task.stepCode === 'P1.2A'", "task.stepCode === 'P2.4'");

fs.writeFileSync('src/app/dashboard/tasks/[id]/page.tsx', content, 'utf8');
