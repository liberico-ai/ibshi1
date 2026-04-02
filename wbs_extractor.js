const fs = require('fs');

function run() {
  let txt = fs.readFileSync('src/app/dashboard/tasks/[id]/page.tsx', 'utf8');

  const startMarker = "                {/* P1.2A & P1.3: Dynamic WBS Table \u2014 based on BCTH-IBSHI-QLDA-095 */}";
  const endMarker = "                {/* P3.1: Readonly WBS from P1.2A + Long-lead items form */}";

  const startIdx = txt.indexOf(startMarker);
  const endIdx = txt.indexOf(endMarker);

  if (startIdx === -1) { console.log('startMarker not found'); return; }
  if (endIdx === -1) { console.log('endMarker not found'); return; }

  let block = txt.substring(startIdx, endIdx);

  // Replace signature
  block = block.replace("{(task.stepCode === 'P1.2A' || task.stepCode === 'P1.3') && (() => {", "  const renderWbsTableUI = (isWbsEditable: boolean) => {");
  
  // Remove inner isWbsEditable declaration
  block = block.replace("const isWbsEditable = isActive && task.stepCode === 'P1.2A'", "");

  // Fix the closing
  block = block.trim();
  if (block.endsWith("})()}")) {
    block = block.slice(0, -5) + "  }";
  } else if (block.endsWith("})()")) {
    block = block.slice(0, -4) + "  }";
  }

  // Remove the block from the original place
  txt = txt.substring(0, startIdx) + 
        "                {/* P1.2A: Dynamic WBS Table \u2014 based on BCTH-IBSHI-QLDA-095 */}\n" +
        "                {task.stepCode === 'P1.2A' && renderWbsTableUI(isActive)}\n\n" +
        txt.substring(endIdx);

  // Insert renderWbsTableUI right before return
  const returnMarker = "  return (\r\n    <div style={{ maxWidth: 960, margin: '0 auto' }}>";
  const returnIdx = txt.indexOf(returnMarker);

  if (returnIdx === -1) {
    console.log('returnMarker not found');
    return;
  }

  txt = txt.substring(0, returnIdx) + 
        block + "\n\n" + 
        txt.substring(returnIdx);

  // Insert call for P1.3
  txt = txt.replace(
    "{/* WBS Display has been removed from here and is now rendered natively below */}",
    "{/* WBS Display natively integrated */}\n                      <div style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>\n                        {renderWbsTableUI(false)}\n                      </div>"
  );

  fs.writeFileSync('src/app/dashboard/tasks/[id]/page.tsx', txt, 'utf8');
  console.log('Successfully refactored page.tsx!');
}

run();
