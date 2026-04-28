const XLSX = require('xlsx');

function analyzeExcel() {
  const filePath = 'c:\\Users\\sontt\\.gemini\\antigravity\\scratch\\antigravity-kit-workspace\\erp-ibshi-v2\\ibshi1\\20250913_Dinh muc ton kho vat tu tieu hao theo tuan Rev2.xlsx';
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Parse to JSON without header row (raw array of arrays)
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log("DATA SAMPLE (Rows 5 to 20):");
    for(let i=5; i<20; i++) {
        console.log(`Row ${i}:`, data[i]);
    }
    
  } catch (error) {
    console.error("Error reading Excel file:", error);
  }
}

analyzeExcel();
