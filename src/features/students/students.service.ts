import { prisma } from '../../config/db';
import { changeOwnPassword } from '../../shared/services/account.service';
import { UpdateProfileSchema } from './students.validation';

// ── GET /students/profile ─────────────────────────────────────
// Returns the logged-in PARENT's own profile plus every child
// (Student row) linked to them — a parent may have multiple children.
export const getProfile = async (userId: string) => {
  const parent = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const children = await prisma.student.findMany({
    where:   { parentUserId: userId },
    include: { class: true, section: true },
    orderBy: { name: 'asc' },
  });

  return {
    parent: {
      id:    parent.id,
      name:  parent.name,
      email: parent.email,
      phone: parent.phone,
    },
    children: children.map(s => ({
      id:                   s.id,
      admissionNo:          s.admissionNo,
      name:                 s.name,
      gender:               s.gender,
      dateOfBirth:          s.dateOfBirth,
      classId:              s.classId,
      className:            s.class.name,
      sectionId:            s.sectionId,
      sectionName:          s.section.name,
      rollNo:               s.rollNo,
      bloodGroup:           s.bloodGroup,
      address:              s.address,
      status:               s.status,
      attendancePercentage: s.attendancePercentage,
    })),
  };
};

// ── PATCH /students/profile ───────────────────────────────────
// Only the parent's own name/phone are self-editable — the child's
// student record (class, roll no, attendance...) is admin/teacher-managed.
export const updateProfile = async (userId: string, input: UpdateProfileSchema) => {
  const user = await prisma.user.update({ where: { id: userId }, data: input });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
};

// ── POST /students/reset-password ─────────────────────────────
export const resetPassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  await changeOwnPassword(userId, currentPassword, newPassword);
};
