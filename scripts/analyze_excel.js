const XLSX = require('xlsx');

function analyzeExcel() {
  const filePath = 'c:\\Users\\sontt\\.gemini\\antigravity\\scratch\\antigravity-kit-workspace\\erp-ibshi-v2\\ibshi1\\Du_lieu_vat_tu.xlsx';
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Parse to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Get headers (first row)
    const headers = data[0];
    console.log("HEADERS:");
    console.log(headers);
    
    console.log("\nDATA SAMPLE (First 3 rows):");
    console.log(data.slice(1, 4));
    
    console.log(`\nTOTAL ROWS: ${data.length - 1}`);
  } catch (error) {
    console.error("Error reading Excel file:", error);
  }
}

analyzeExcel();
