import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SCHOOL_ID = 'a5b5e13f-df50-4a12-a534-4928abc1b4cf';
const ADMIN_USER_ID = '73cf62b4-f3fd-44b7-8c1b-ddd3682bc062'; // Anil Saini (ADMIN)

// ── Some parent user IDs for parent queries ──
const PARENT_IDS = [
  '9ac55df5-1b83-4f38-b2e1-60d5c9c3e93a', // Govind Pandey
  '54cb7726-7393-44df-a77a-28221be32c29', // Bhupendra Rathore
  'ee6a1051-43aa-45c7-be16-c225550c3f74', // Gurpreet Singh
  '3cbcec34-9f03-42f8-8e5b-7a160cdb1f6b', // Om Prakash
  '80ca43da-2962-4372-915c-cb800994f86e', // Suresh Bhatt
  '1ba08b91-941e-4c2e-a885-4c9127092378', // Pramod Joshi
];

// ── Teacher IDs with employee codes and salaries ──
const TEACHERS = [
  { id: '6ef8444c-6104-43a3-93c4-86bb049e3be4', empId: 'EMP0001', userId: 'b85b4ced-444e-42ab-930a-53e89aef62ee', salary: 12000, name: 'Kanha' },
  { id: '23e71507-104d-437d-9890-7437d4def8e2', empId: 'EMP0002', userId: '123807af-83bc-40cb-b3bc-0b7623b34e96', salary: 15200, name: 'Narendar' },
  { id: '98f3b44e-e053-4fbf-895d-a2d8528b0549', empId: 'EMP0003', userId: 'f1873718-fddd-4133-b60f-7066474dd52d', salary: 15000, name: 'Suraj' },
  { id: '288ab5e8-b662-4204-bff0-d5f5c1b26b22', empId: 'EMP0004', userId: '65b80ef5-ffd9-4dc6-9dcf-a894d8eac1f5', salary: 45000, name: 'Anita Sarma' },
  { id: '6e55d283-79f1-4557-8ade-d60f4190b31f', empId: 'EMP0005', userId: 'd816ff45-230b-4d14-bfd9-b5114d25b1f4', salary: 30000, name: 'Khusboo' },
  { id: 'dcbf439c-a303-49f1-a3ee-6cac0a376f42', empId: 'EMP0006', userId: '8cc5168c-776b-49e9-8573-9ac470eb022e', salary: 42000, name: 'Vijay' },
  { id: 'e34f7278-3a38-4955-8c80-7d92de0b8162', empId: 'EMP0007', userId: 'c9646977-8c44-421d-a1f3-4343cc14cd70', salary: 35000, name: 'Meena Sharma' },
  { id: 'f14a520e-ebe2-4774-9ba7-d288a943b663', empId: 'EMP0008', userId: '3e84ac79-16a0-4e02-b533-420be3de53e4', salary: 38000, name: 'Priya Gupta' },
  { id: '52a9e9ed-d241-4694-889a-4b852bb890d7', empId: 'EMP0009', userId: 'b6fc8b3d-dcb8-4abd-9edf-5dec4aa17305', salary: 32000, name: 'Rakesh Kumar' },
  { id: 'c1b0fa53-1e6d-48ba-a34b-6be4eaa90f32', empId: 'EMP0010', userId: '46ea3646-6fd9-43ff-8a56-d81d591db187', salary: 30000, name: 'Deepak Verma' },
  { id: '77271130-48ab-4788-b481-0f105b145996', empId: 'EMP0011', userId: '1b7700a7-650a-4c41-bd86-55908b770e2b', salary: 28000, name: 'Sunita Devi' },
  { id: 'f9003ecd-99a2-4f60-ae10-54a57eb9146f', empId: 'EMP0012', userId: '943b6894-0c5b-42a9-aca5-239a5b830cd2', salary: 25000, name: 'Amit Patel' },
  { id: 'f70f12a6-260c-4f90-bdc6-a873f35a479a', empId: 'EMP0013', userId: '48d99ee4-0254-4703-bc51-8b65ff872bd9', salary: 42000, name: 'Pooja Singh' },
  { id: '4b6524bc-28d3-4611-ace7-0634d1fed8cb', empId: 'EMP0014', userId: '4dffe9cd-1a32-48da-902f-03f9ea62a732', salary: 40000, name: 'Ravi Tiwari' },
  { id: '6691dbef-7067-4f46-8e6c-df715c048ff2', empId: 'EMP0015', userId: '9b927f20-1750-4c2f-8c09-960ae38395b6', salary: 38000, name: 'Neha Joshi' },
  { id: '6cb795aa-62e2-4547-a068-7bba235aa807', empId: 'EMP0016', userId: '0e539ac3-cf1d-4f12-8c66-93cf576b7589', salary: 36000, name: 'Manoj Yadav' },
  { id: 'ab4c2d09-a64a-4c78-ac5a-0ac63dbca01e', empId: 'EMP0017', userId: 'a43b9294-045b-48cf-9f60-2cc57ec691a4', salary: 40000, name: 'Sanjay Mishra' },
  { id: '3781b624-3e4f-489b-a35f-671078afad15', empId: 'EMP0018', userId: '28efd89b-188f-4b9f-9002-3538714ee976', salary: 30000, name: 'Kavita Rani' },
  { id: 'd95da296-f4d3-486a-be69-96095289c709', empId: 'EMP0019', userId: 'df39b78c-127c-4b74-b4bb-e0ba7449a8fe', salary: 33000, name: 'Ramesh Chandra' },
  { id: 'dfbc7ffb-bce4-478b-ae35-2449ad22900a', empId: 'EMP0020', userId: '6f3d1187-3818-4265-addd-799fcdc446db', salary: 34000, name: 'Geeta Kumari' },
];

// ── Staff ──
const STAFF = [
  { id: 'fe2a1ff4-1670-42eb-b1e5-d0912e3b2e82', empId: 'STF0001', name: 'Kaka', salary: 20200 },
  { id: 'f062ed93-92e2-4726-a1b5-b84767d7f813', empId: 'STF0002', name: 'Suresh Kumar', salary: 25000 },
];

// ── Students (a subset — 20 for StudentFee, all will get fee structures) ──
const STUDENTS_SAMPLE = [
  { id: '5b0903d6-96bc-4ff5-8ca5-4d6ae2862d9c', name: 'Aarav Gupta', classId: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f' },
  { id: '5f0cfa80-dfa2-40dc-84e8-921f2b65de08', name: 'Diya Singh', classId: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f' },
  { id: 'f3e255a2-352a-4f74-9a35-29b44cac4b3e', name: 'Reyansh Kumar', classId: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f' },
  { id: 'f41eeebb-bf9d-4fce-a704-f91d64f29205', name: 'Lakshya Reddy', classId: 'c9d60fbc-bc6c-4360-9e51-53d3b4208661' },
  { id: '151bf658-7291-4d98-90f0-b88146c82214', name: 'Kabir Tiwari', classId: 'c9d60fbc-bc6c-4360-9e51-53d3b4208661' },
  { id: '3798b84b-2d24-4bf0-b2cf-9f86116aa91a', name: 'Rohit Sharma', classId: '30ffe980-e7a3-422f-b048-094c727b5305' },
  { id: '9693b992-fd13-45f1-bd6b-5a22dcff620e', name: 'Shruti Sinha', classId: '63bdbf8b-e38e-4fec-b636-bbd304d91086' },
  { id: '8b809858-08b8-40cb-b4c2-efd6230cd5e9', name: 'Arjun Mehta', classId: '5c800f26-9943-43ba-80f0-f58f1c65ef27' },
  { id: '4b9d2268-1456-44e8-b458-ea8ae8162dcb', name: 'Vaibhav Gupta', classId: 'c76688ef-396f-4fbc-b8a2-53a10436c026' },
  { id: 'f96b7b5d-8f36-4c8b-967c-907367ea13d6', name: 'Piyush Kumar', classId: '8a4fad2c-4ebe-4a2b-864a-2cbdf86a3aad' },
  { id: 'd9a3aeab-6fbb-41b4-b5c3-4ce9261a8293', name: 'Megha Pandey', classId: 'fa8248f5-4b1a-4a7d-834a-5cd8420b9430' },
  { id: 'a48fc025-2c84-43ac-9596-6f608bbefd82', name: 'Simran Kaur', classId: 'c192669d-edda-42b9-b066-99b1d930edfb' },
  { id: '030c01eb-3d5f-44e8-aad7-595757266caf', name: 'Tanvi Desai', classId: 'f8daee07-1d03-4488-9a25-9ee8506d513e' },
  { id: '7af5d3f1-3118-42f5-8d86-c4ec6ddfbda4', name: 'Sahil Kumar', classId: 'e9e25fd5-9c87-4bd5-999f-9cc9c767c3db' },
  { id: '3b722655-c04d-4b34-97b9-0be807edc499', name: 'Rohan Malhotra', classId: '062aa066-eefd-47d0-bb18-0962cd7b68b9' },
];

// ── Fee structures (global ones classId=null, and class-specific) ──
const GLOBAL_FEE_STRUCTURES = [
  { id: '7d7c5b7c-6f2e-418f-9060-26ff1c4f2737', name: 'Tuition Fee Q1 (Apr-Jun)', amount: 5000, category: 'TUITION' },
  { id: '0fed3fa0-0dcc-4ec9-8903-a15de1c30a39', name: 'Tuition Fee Q2 (Jul-Sep)', amount: 5000, category: 'TUITION' },
  { id: '6fbacd04-7e0c-4092-8c49-2d50bed92db8', name: 'Tuition Fee Q3 (Oct-Dec)', amount: 5000, category: 'TUITION' },
  { id: '6a9fbca7-15d4-4d65-80f5-61aa01efc28d', name: 'Annual Admission Fee', amount: 2000, category: 'ADMISSION' },
  { id: '632063ec-1aed-40c6-92e2-dc311ceb24b7', name: 'Examination Fee', amount: 500, category: 'EXAM' },
  { id: 'f2c028fe-639a-4f1a-a834-99d6cc427be6', name: 'Sports Fee (Annual)', amount: 800, category: 'SPORTS' },
];

const CLASS_FEE_MAP: Record<string, { id: string; name: string; amount: number; category: string }[]> = {
  'c76688ef-396f-4fbc-b8a2-53a10436c026': [{ id: '532257db-2fe9-4538-9760-f7ec01a2e400', name: 'Computer Lab Fee', amount: 1200, category: 'LAB' }],
  '8a4fad2c-4ebe-4a2b-864a-2cbdf86a3aad': [{ id: '5b9365b1-0713-400e-8dee-9b88fd8bf103', name: 'Computer Lab Fee', amount: 1200, category: 'LAB' }],
  'fa8248f5-4b1a-4a7d-834a-5cd8420b9430': [{ id: '0a875c05-66b5-4635-9b66-59cffd939a99', name: 'Computer Lab Fee', amount: 1200, category: 'LAB' }],
  'c192669d-edda-42b9-b066-99b1d930edfb': [{ id: 'c0bb2bcc-0b2a-49df-9312-51e1611b26ff', name: 'Computer Lab Fee', amount: 1500, category: 'LAB' }],
  '062aa066-eefd-47d0-bb18-0962cd7b68b9': [{ id: 'ae211cec-fe48-45d6-9b24-6f8cd69d1f7d', name: 'Computer Lab Fee', amount: 1500, category: 'LAB' }],
  'f8daee07-1d03-4488-9a25-9ee8506d513e': [{ id: '8f390c08-2cfe-4beb-bc99-705aa905e95b', name: 'Science Lab Fee', amount: 2000, category: 'LAB' }],
  'e9e25fd5-9c87-4bd5-999f-9cc9c767c3db': [{ id: '8bb07ba2-3ed4-446f-8946-e3fce3f01ed1', name: 'Science Lab Fee', amount: 2000, category: 'LAB' }],
};

// Classes
const CLASSES = [
  { id: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f', name: 'Class 1', sectionA: 'fed78635-bc52-4f07-8bd8-04c8289812ea' },
  { id: 'c9d60fbc-bc6c-4360-9e51-53d3b4208661', name: 'Class 2', sectionA: 'd68014fe-e0d7-4b85-b0ca-628b522e867e' },
  { id: '30ffe980-e7a3-422f-b048-094c727b5305', name: 'Class 3', sectionA: '101baa72-e4c6-497a-b87b-a1d3fdafdd06' },
  { id: '63bdbf8b-e38e-4fec-b636-bbd304d91086', name: 'Class 4', sectionA: '913708df-9ba3-41f8-8e92-9fdca3951358' },
  { id: '5c800f26-9943-43ba-80f0-f58f1c65ef27', name: 'Class 5', sectionA: '02793377-a6c6-417d-93bc-c82a0f86ef9e' },
  { id: 'c76688ef-396f-4fbc-b8a2-53a10436c026', name: 'Class 6', sectionA: 'a92715ba-5ef6-42ed-8b40-231d09c9e978' },
  { id: '8a4fad2c-4ebe-4a2b-864a-2cbdf86a3aad', name: 'Class 7', sectionA: 'd1b7bf27-ac4f-41e0-9c74-ff9a223042f5' },
];

const PAYMENT_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE'] as const;

async function main() {
  console.log('🚀 Starting live data seeding...\n');

  // ═══════════════════════════════════════════════════
  // 1. Academic Session
  // ═══════════════════════════════════════════════════
  console.log('📅 Creating Academic Session...');
  const session = await prisma.academicSession.create({
    data: {
      schoolId: SCHOOL_ID,
      name: '2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });
  console.log(`  ✅ Academic Session: ${session.name} (${session.id})`);

  // ═══════════════════════════════════════════════════
  // 2. School Sequences (for receipts & salary slips)
  // ═══════════════════════════════════════════════════
  console.log('\n🔢 Creating School Sequences...');
  await prisma.schoolSequence.createMany({
    data: [
      { schoolId: SCHOOL_ID, name: 'fee_receipt', value: 0 },
      { schoolId: SCHOOL_ID, name: 'salary_slip', value: 0 },
      { schoolId: SCHOOL_ID, name: 'admission_app', value: 0 },
    ],
  });
  console.log('  ✅ Sequences created: fee_receipt, salary_slip, admission_app');

  // ═══════════════════════════════════════════════════
  // 3. StudentFee + FeePayment for 15 students
  // ═══════════════════════════════════════════════════
  console.log('\n💰 Creating Student Fees & Payments...');
  let receiptCounter = 0;

  for (const student of STUDENTS_SAMPLE) {
    // Global fees for all students
    const feesToAssign = [...GLOBAL_FEE_STRUCTURES];
    // Class-specific fees
    const classFees = CLASS_FEE_MAP[student.classId];
    if (classFees) feesToAssign.push(...classFees);

    for (const fee of feesToAssign) {
      const shouldPay = Math.random() > 0.4; // 60% chance already paid
      const isPartial = shouldPay && Math.random() > 0.6; // 40% of paid are partial
      const hasDiscount = Math.random() > 0.8; // 20% get some discount
      const hasFine = !shouldPay && Math.random() > 0.7; // 30% of unpaid have fine

      const discount = hasDiscount ? Math.floor(fee.amount * 0.1) : 0;
      const fine = hasFine ? Math.round(fee.amount * 0.05) : 0;
      const payable = fee.amount - discount + fine;
      const paidAmount = shouldPay ? (isPartial ? Math.floor(payable * 0.5) : payable) : 0;

      let status: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
      if (paidAmount >= payable) status = 'PAID';
      else if (paidAmount > 0) status = 'PARTIAL';

      const studentFee = await prisma.studentFee.create({
        data: {
          schoolId: SCHOOL_ID,
          studentId: student.id,
          feeStructureId: fee.id,
          title: fee.name,
          category: fee.category,
          sessionYear: 2026,
          amount: new Prisma.Decimal(fee.amount),
          discount: new Prisma.Decimal(discount),
          fine: new Prisma.Decimal(fine),
          paidAmount: new Prisma.Decimal(paidAmount),
          dueDate: new Date('2026-07-15'),
          status,
        },
      });

      // Create payment if something was paid
      if (paidAmount > 0) {
        receiptCounter++;
        const receiptNo = `RCP${String(receiptCounter).padStart(4, '0')}`;
        const mode = PAYMENT_MODES[Math.floor(Math.random() * PAYMENT_MODES.length)];
        const paidDate = new Date(`2026-${String(4 + Math.floor(Math.random() * 7)).padStart(2, '0')}-${String(5 + Math.floor(Math.random() * 20)).padStart(2, '0')}`);

        await prisma.feePayment.create({
          data: {
            schoolId: SCHOOL_ID,
            studentFeeId: studentFee.id,
            studentId: student.id,
            receiptNo,
            amount: new Prisma.Decimal(paidAmount),
            mode,
            referenceNo: mode === 'CASH' ? null : `REF${Date.now().toString(36).toUpperCase()}${receiptCounter}`,
            paidAt: paidDate,
            note: null,
            collectedBy: ADMIN_USER_ID,
          },
        });
      }
    }
  }

  // Update sequence
  await prisma.schoolSequence.update({
    where: { schoolId_name: { schoolId: SCHOOL_ID, name: 'fee_receipt' } },
    data: { value: receiptCounter },
  });
  console.log(`  ✅ Created StudentFees for ${STUDENTS_SAMPLE.length} students, ${receiptCounter} payments`);

  // ═══════════════════════════════════════════════════
  // 4. Salary Slips — Oct & Nov 2026 for all teachers + staff
  // ═══════════════════════════════════════════════════
  console.log('\n💵 Creating Salary Slips...');
  let slipCounter = 0;

  for (const month of [10, 11]) {
    // Teachers
    for (const t of TEACHERS) {
      slipCounter++;
      const hra = Math.round(t.salary * 0.15);
      const da = Math.round(t.salary * 0.08);
      const ta = 1500;
      const pf = Math.round(t.salary * 0.12);
      const tds = t.salary > 35000 ? Math.round(t.salary * 0.05) : 0;
      const profTax = 200;

      const gross = t.salary + hra + da + ta;
      const totalDed = pf + tds + profTax;
      const net = gross - totalDed;

      const isOct = month === 10;
      const status = isOct ? 'CREDITED' : (Math.random() > 0.3 ? 'PENDING' : 'CREDITED');

      await prisma.salarySlip.create({
        data: {
          schoolId: SCHOOL_ID,
          slipNo: `SAL${String(slipCounter).padStart(4, '0')}`,
          employeeType: 'TEACHER',
          teacherId: t.id,
          staffId: null,
          employeeName: t.name,
          employeeCode: t.empId,
          month,
          year: 2026,
          baseSalary: new Prisma.Decimal(t.salary),
          allowances: JSON.stringify([
            { label: 'HRA', amount: hra },
            { label: 'DA', amount: da },
            { label: 'Transport Allowance', amount: ta },
          ]),
          deductions: JSON.stringify([
            { label: 'PF', amount: pf },
            ...(tds > 0 ? [{ label: 'TDS', amount: tds }] : []),
            { label: 'Professional Tax', amount: profTax },
          ]),
          grossAmount: new Prisma.Decimal(gross),
          totalDeductions: new Prisma.Decimal(totalDed),
          netAmount: new Prisma.Decimal(net),
          status: status as any,
          paymentMode: status === 'CREDITED' ? 'BANK_TRANSFER' : null,
          referenceNo: status === 'CREDITED' ? `UTR${Date.now().toString(36).toUpperCase()}${slipCounter}` : null,
          creditedAt: status === 'CREDITED' ? new Date(`2026-${month}-28`) : null,
          creditedBy: status === 'CREDITED' ? ADMIN_USER_ID : null,
        },
      });
    }

    // Staff
    for (const s of STAFF) {
      slipCounter++;
      const hra = Math.round(s.salary * 0.10);
      const da = Math.round(s.salary * 0.05);
      const pf = Math.round(s.salary * 0.12);
      const profTax = 200;

      const gross = s.salary + hra + da;
      const totalDed = pf + profTax;
      const net = gross - totalDed;

      const isOct = month === 10;
      const status = isOct ? 'CREDITED' : 'PENDING';

      await prisma.salarySlip.create({
        data: {
          schoolId: SCHOOL_ID,
          slipNo: `SAL${String(slipCounter).padStart(4, '0')}`,
          employeeType: 'STAFF',
          teacherId: null,
          staffId: s.id,
          employeeName: s.name,
          employeeCode: s.empId,
          month,
          year: 2026,
          baseSalary: new Prisma.Decimal(s.salary),
          allowances: JSON.stringify([
            { label: 'HRA', amount: hra },
            { label: 'DA', amount: da },
          ]),
          deductions: JSON.stringify([
            { label: 'PF', amount: pf },
            { label: 'Professional Tax', amount: profTax },
          ]),
          grossAmount: new Prisma.Decimal(gross),
          totalDeductions: new Prisma.Decimal(totalDed),
          netAmount: new Prisma.Decimal(net),
          status: status as any,
          paymentMode: status === 'CREDITED' ? 'BANK_TRANSFER' : null,
          referenceNo: status === 'CREDITED' ? `UTR${Date.now().toString(36).toUpperCase()}${slipCounter}` : null,
          creditedAt: status === 'CREDITED' ? new Date(`2026-${month}-28`) : null,
          creditedBy: status === 'CREDITED' ? ADMIN_USER_ID : null,
        },
      });
    }
  }

  await prisma.schoolSequence.update({
    where: { schoolId_name: { schoolId: SCHOOL_ID, name: 'salary_slip' } },
    data: { value: slipCounter },
  });
  console.log(`  ✅ Created ${slipCounter} salary slips (Oct & Nov 2026)`);

  // ═══════════════════════════════════════════════════
  // 5. Admissions (5 sample entries)
  // ═══════════════════════════════════════════════════
  console.log('\n📋 Creating Admissions...');
  const admissionData = [
    { studentName: 'Aryan Kapoor', gender: 'MALE', dob: '2018-03-15', classId: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f', parentName: 'Rajesh Kapoor', parentPhone: '9876543210', parentEmail: 'rajesh.kapoor@gmail.com', status: 'INQUIRY', previousSchool: 'DPS Jaipur' },
    { studentName: 'Meera Verma', gender: 'FEMALE', dob: '2017-07-22', classId: 'c9d60fbc-bc6c-4360-9e51-53d3b4208661', parentName: 'Vinod Verma', parentPhone: '9876543211', parentEmail: 'vinod.verma@gmail.com', status: 'APPLIED', previousSchool: 'Ryan International' },
    { studentName: 'Kunal Joshi', gender: 'MALE', dob: '2016-11-08', classId: '30ffe980-e7a3-422f-b048-094c727b5305', parentName: 'Pankaj Joshi', parentPhone: '9876543212', parentEmail: 'pankaj.joshi@gmail.com', status: 'APPROVED', previousSchool: null },
    { studentName: 'Nisha Patel', gender: 'FEMALE', dob: '2019-01-30', classId: 'c6235f4d-ca82-450c-90bd-67cc2d123f6f', parentName: 'Amit Patel', parentPhone: '9876543213', parentEmail: 'amit.patel2@gmail.com', status: 'ENROLLED', previousSchool: 'St. Xavier' },
    { studentName: 'Rohan Desai', gender: 'MALE', dob: '2015-06-14', classId: '63bdbf8b-e38e-4fec-b636-bbd304d91086', parentName: 'Mahesh Desai', parentPhone: '9876543214', parentEmail: 'mahesh.desai@gmail.com', status: 'REJECTED', previousSchool: 'Kendriya Vidyalaya', remarks: 'No seats available' },
  ];

  for (let i = 0; i < admissionData.length; i++) {
    const a = admissionData[i];
    await prisma.admission.create({
      data: {
        schoolId: SCHOOL_ID,
        academicSessionId: session.id,
        applicationNo: `APP${String(i + 1).padStart(4, '0')}`,
        studentName: a.studentName,
        gender: a.gender as any,
        dateOfBirth: new Date(a.dob),
        classId: a.classId,
        parentName: a.parentName,
        parentPhone: a.parentPhone,
        parentEmail: a.parentEmail,
        previousSchool: a.previousSchool,
        status: a.status as any,
        remarks: (a as any).remarks ?? null,
        createdBy: ADMIN_USER_ID,
      },
    });
  }

  await prisma.schoolSequence.update({
    where: { schoolId_name: { schoolId: SCHOOL_ID, name: 'admission_app' } },
    data: { value: 5 },
  });
  console.log(`  ✅ Created 5 admissions`);

  // ═══════════════════════════════════════════════════
  // 6. Parent Queries
  // ═══════════════════════════════════════════════════
  console.log('\n❓ Creating Parent Queries...');
  const queries = [
    { parentId: PARENT_IDS[0], subject: 'Fee Payment Confusion', message: 'Mujhe Q2 ki fees ka receipt nahi mila, please check karein.', status: 'OPEN' },
    { parentId: PARENT_IDS[1], subject: 'Transport Route Change', message: 'Kya bus route #3 mein koi change hua hai? Mera bachcha late aa raha hai.', status: 'RESOLVED', reply: 'Bus route mein koi change nahi hua hai, driver se baat ki gayi hai.' },
    { parentId: PARENT_IDS[2], subject: 'Exam Date Sheet', message: 'Half yearly exam ki date sheet kab publish hogi?', status: 'IN_PROGRESS' },
    { parentId: PARENT_IDS[3], subject: 'Homework Load', message: 'Class 2 mein bahut zyada homework diya ja raha hai, please review karein.', status: 'OPEN' },
    { parentId: PARENT_IDS[4], subject: 'PTM Schedule', message: 'Next PTM kab hai? Calendar mein nahi dikh raha.', status: 'RESOLVED', reply: 'Next PTM 15 December ko hai. Calendar update kar diya gaya hai.' },
    { parentId: PARENT_IDS[5], subject: 'Science Lab Safety', message: 'Science lab mein safety goggles available hain ya hum ghar se bhejein?', status: 'CLOSED', reply: 'Lab mein sabhi safety equipment available hai. Bachchon ko kuch laane ki zaroorat nahi hai.' },
  ];

  for (const q of queries) {
    await prisma.parentQuery.create({
      data: {
        schoolId: SCHOOL_ID,
        createdBy: q.parentId,
        subject: q.subject,
        message: q.message,
        status: q.status as any,
        reply: q.reply ?? null,
        repliedAt: q.reply ? new Date('2026-11-15') : null,
        repliedBy: q.reply ? ADMIN_USER_ID : null,
      },
    });
  }
  console.log(`  ✅ Created ${queries.length} parent queries`);

  // ═══════════════════════════════════════════════════
  // 7. Crash Reports
  // ═══════════════════════════════════════════════════
  console.log('\n🐛 Creating Crash Reports...');
  const crashes = [
    { userId: PARENT_IDS[0], errorMessage: 'TypeError: Cannot read property \'length\' of undefined', stackTrace: 'at HomeScreen.render (HomeScreen.tsx:45)\n  at processChild (ReactNativeRenderer.js:1234)', errorType: 'TypeError', platform: 'ANDROID', appVersion: '1.2.0', osVersion: '14', deviceModel: 'Samsung Galaxy S23', isFatal: true },
    { userId: PARENT_IDS[1], errorMessage: 'Network request failed', stackTrace: 'at fetch (networking.js:12)\n  at ApiService.get (api.ts:89)', errorType: 'NetworkError', platform: 'IOS', appVersion: '1.2.0', osVersion: '17.4', deviceModel: 'iPhone 15', isFatal: false },
    { userId: TEACHERS[0].userId, errorMessage: 'RangeError: Maximum call stack size exceeded', stackTrace: 'at AttendanceList.componentDidUpdate (AttendanceList.tsx:78)\n  at commitLifeCycles (ReactNativeRenderer.js:5678)', errorType: 'RangeError', platform: 'ANDROID', appVersion: '1.1.9', osVersion: '13', deviceModel: 'Redmi Note 12', isFatal: true },
    { userId: PARENT_IDS[2], errorMessage: 'Error: Invariant Violation: Text strings must be rendered within a <Text> component', stackTrace: 'at NotificationsScreen (NotificationsScreen.tsx:32)\n  at RenderRoot (ReactNativeRenderer.js:456)', errorType: 'InvariantViolation', platform: 'ANDROID', appVersion: '1.2.0', osVersion: '12', deviceModel: 'OnePlus 11', isFatal: true },
    { userId: null, errorMessage: 'SyntaxError: Unexpected token < in JSON at position 0', stackTrace: 'at JSON.parse (<anonymous>)\n  at parseResponse (api.ts:23)', errorType: 'SyntaxError', platform: 'IOS', appVersion: '1.2.0', osVersion: '16.6', deviceModel: 'iPhone 14 Pro', isFatal: false },
  ];

  for (let i = 0; i < crashes.length; i++) {
    const c = crashes[i];
    await prisma.crashReport.create({
      data: {
        userId: c.userId,
        appVersion: c.appVersion,
        buildNumber: `${100 + i}`,
        platform: c.platform as any,
        osVersion: c.osVersion,
        deviceModel: c.deviceModel,
        errorMessage: c.errorMessage,
        stackTrace: c.stackTrace,
        errorType: c.errorType,
        isFatal: c.isFatal,
        crashedAt: new Date(`2026-11-${String(10 + i * 2).padStart(2, '0')}T${String(8 + i)}:30:00Z`),
        metadata: JSON.stringify({ screen: ['Home', 'Attendance', 'Notifications', 'Fees', 'Profile'][i] }),
      },
    });
  }
  console.log(`  ✅ Created ${crashes.length} crash reports`);

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════════');
  console.log('✅ All data seeded successfully!');
  console.log('────────────────────────────────────────────');
  console.log(`  Academic Sessions: 1`);
  console.log(`  School Sequences:  3`);
  console.log(`  Student Fees:      ~${STUDENTS_SAMPLE.length * 7} (${STUDENTS_SAMPLE.length} students × ~7 fees each)`);
  console.log(`  Fee Payments:      ${receiptCounter}`);
  console.log(`  Salary Slips:      ${slipCounter}`);
  console.log(`  Admissions:        5`);
  console.log(`  Parent Queries:    ${queries.length}`);
  console.log(`  Crash Reports:     ${crashes.length}`);
  console.log('════════════════════════════════════════════');
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
