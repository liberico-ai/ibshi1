"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var materials, _i, materials_1, m, existing;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    materials = [
                        // VT chính (Thép, Ống, Van, v.v.)
                        { materialCode: 'STEEL-PL-001', name: 'Thép tấm 10mm', nameEn: 'Steel Plate 10mm', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70', minStock: 1000, currentStock: 5000, unitPrice: 25000, currency: 'VND' },
                        { materialCode: 'STEEL-PL-002', name: 'Thép tấm 12mm', nameEn: 'Steel Plate 12mm', unit: 'kg', category: 'steel', specification: 'SA-516 Gr.70', minStock: 1000, currentStock: 4500, unitPrice: 25500, currency: 'VND' },
                        { materialCode: 'PIPE-SML-001', name: 'Ống đúc DN100 SCH40', nameEn: 'Seamless Pipe DN100 SCH40', unit: 'm', category: 'pipe', specification: 'A106 Gr.B', minStock: 100, currentStock: 300, unitPrice: 150000, currency: 'VND' },
                        { materialCode: 'PIPE-SML-002', name: 'Ống đúc DN150 SCH40', nameEn: 'Seamless Pipe DN150 SCH40', unit: 'm', category: 'pipe', specification: 'A106 Gr.B', minStock: 50, currentStock: 150, unitPrice: 220000, currency: 'VND' },
                        { materialCode: 'BEAM-H-001', name: 'Thép hình H200x200', nameEn: 'H-Beam 200x200', unit: 'kg', category: 'steel', specification: 'SS400', minStock: 500, currentStock: 2000, unitPrice: 21000, currency: 'VND' },
                        // VT sơn hàn (Sơn, Que hàn, Dây hàn)
                        { materialCode: 'WELD-WIRE-001', name: 'Dây hàn lõi thuốc E71T-1 1.2mm', nameEn: 'FCAW Wire E71T-1 1.2mm', unit: 'kg', category: 'welding', specification: 'AWS A5.20', minStock: 200, currentStock: 800, unitPrice: 45000, currency: 'VND' },
                        { materialCode: 'WELD-ELEC-001', name: 'Que hàn chịu lực E7018 3.2mm', nameEn: 'Welding Electrode E7018 3.2mm', unit: 'kg', category: 'welding', specification: 'AWS A5.1', minStock: 100, currentStock: 500, unitPrice: 38000, currency: 'VND' },
                        { materialCode: 'PAINT-PRM-001', name: 'Sơn lót Epoxy giàu kẽm', nameEn: 'Zinc Rich Epoxy Primer', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 100, currentStock: 300, unitPrice: 180000, currency: 'VND' },
                        { materialCode: 'PAINT-TOP-001', name: 'Sơn phủ Polyurethane xám', nameEn: 'PU Topcoat Grey', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 100, currentStock: 250, unitPrice: 210000, currency: 'VND' },
                        { materialCode: 'THINNER-001', name: 'Dung môi pha sơn số 17', nameEn: 'Thinner No.17', unit: 'lít', category: 'paint', specification: 'Jotun', minStock: 50, currentStock: 150, unitPrice: 95000, currency: 'VND' },
                        // VT tiêu hao (Bulong, Đá mài, Đá cắt, Kẽm, Khí)
                        { materialCode: 'BOLT-M16-001', name: 'Bulong cường độ cao M16x50', nameEn: 'High Strength Bolt M16x50', unit: 'bộ', category: 'bolt', specification: '8.8 Hot Dip Galv', minStock: 500, currentStock: 2000, unitPrice: 15000, currency: 'VND' },
                        { materialCode: 'GAS-AR-001', name: 'Khí Argon tinh khiết 99.99%', nameEn: 'Argon Gas 99.99%', unit: 'chai', category: 'consumable', specification: '40L, 150Bar', minStock: 20, currentStock: 50, unitPrice: 350000, currency: 'VND' },
                        { materialCode: 'GAS-CO2-001', name: 'Khí CO2 công nghiệp', nameEn: 'CO2 Gas', unit: 'chai', category: 'consumable', specification: '40L', minStock: 20, currentStock: 60, unitPrice: 250000, currency: 'VND' },
                        { materialCode: 'GRIND-WHEEL-001', name: 'Đá mài Hải Dương 100mm', nameEn: 'Grinding Wheel 100mm', unit: 'cái', category: 'consumable', specification: '100x6x16mm', minStock: 100, currentStock: 300, unitPrice: 22000, currency: 'VND' },
                        { materialCode: 'CUT-WHEEL-001', name: 'Đá cắt Hải Dương 350mm', nameEn: 'Cutting Wheel 350mm', unit: 'cái', category: 'consumable', specification: '350x3x25.4mm', minStock: 50, currentStock: 150, unitPrice: 65000, currency: 'VND' },
                        { materialCode: 'TAPE-001', name: 'Băng keo chịu nhiệt', nameEn: 'Heat Resistant Tape', unit: 'cuộn', category: 'consumable', specification: '50mm', minStock: 50, currentStock: 100, unitPrice: 40000, currency: 'VND' }
                    ];
                    console.log('Bắt đầu thêm Vật tư...');
                    _i = 0, materials_1 = materials;
                    _a.label = 1;
                case 1:
                    if (!(_i < materials_1.length)) return [3 /*break*/, 6];
                    m = materials_1[_i];
                    return [4 /*yield*/, prisma.material.findUnique({ where: { materialCode: m.materialCode } })];
                case 2:
                    existing = _a.sent();
                    if (!!existing) return [3 /*break*/, 4];
                    return [4 /*yield*/, prisma.material.create({ data: m })];
                case 3:
                    _a.sent();
                    console.log("+ \u0110\u00E3 th\u00EAm: ".concat(m.materialCode, " - ").concat(m.name));
                    return [3 /*break*/, 5];
                case 4:
                    console.log("- \u0110\u00E3 t\u1ED3n t\u1EA1i: ".concat(m.materialCode));
                    _a.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 1];
                case 6:
                    console.log('Thêm Vật tư hoàn tất!');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error(e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
