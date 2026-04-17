// populate dev users, a course, and sample content

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // bcrypt cost factor 10; use strong passwords outside local dev
  const adminPassword = await hash('Admin123!', 10);
  const instructorPassword = await hash('Instructor123!', 10);
  const reviewerPassword = await hash('Reviewer123!', 10);
  const studentPassword = await hash('Student123!', 10);

  // upsert so re-running seed does not duplicate rows keyed by email
  const [admin, instructor, reviewer, student] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@syllentra.local' },
      update: {},
      create: {
        email: 'admin@syllentra.local',
        fullName: 'System Admin',
        passwordHash: adminPassword,
        role: 'ADMIN',
      },
    }),
    prisma.user.upsert({
      where: { email: 'instructor@syllentra.local' },
      update: {},
      create: {
        email: 'instructor@syllentra.local',
        fullName: 'Russell Foubert',
        passwordHash: instructorPassword,
        role: 'INSTRUCTOR',
      },
    }),
    prisma.user.upsert({
      where: { email: 'reviewer@syllentra.local' },
      update: {},
      create: {
        email: 'reviewer@syllentra.local',
        fullName: 'Sean Yao',
        passwordHash: reviewerPassword,
        role: 'REVIEWER',
      },
    }),
    prisma.user.upsert({
      where: { email: 'student@syllentra.local' },
      update: {},
      create: {
        email: 'student@syllentra.local',
        fullName: 'Hubert Gates',
        passwordHash: studentPassword,
        role: 'STUDENT',
      },
    }),
  ]);

  // fresh course each run; safe if you reset the DB between seeds
  const course = await prisma.course.create({
    data: {
      title: 'Introduction to Data Literacy',
      description: 'Sample course for local development and testing.',
      backgroundImage: '/stockphoto1.png',
      createdById: instructor.id,
      instructorId: instructor.id,
    },
  });

  // enroll the sample student
  await prisma.enrollment.create({
    data: {
      courseId: course.id,
      studentId: student.id,
    },
  });

  const module = await prisma.courseModule.create({
    data: {
      courseId: course.id,
      title: 'Module 1: Data Fundamentals',
      description: 'Students learn basic data concepts and quality dimensions.',
      learningOutcomes:
        'Explain data quality dimensions and identify common issues in datasets.',
    },
  });

  // approved so it appears as normal published content with coaching
  await prisma.contentItem.create({
    data: {
      moduleId: module.id,
      title: 'Lecture: Data Quality Basics',
      contentType: 'LECTURE_NOTE',
      body: `Data quality is about fitness for purpose. In this lesson, students should understand completeness, consistency, accuracy, and timeliness. Include examples with small datasets and discuss what happens when quality fails.`,
      rubricText:
        'Student work should define at least three dimensions and include one realistic example per dimension.',
      createdById: instructor.id,
      status: 'APPROVED',
    },
  });

  console.log('Seed complete');
  console.log('Admin:', admin.email);
  console.log('Instructor:', instructor.email);
  console.log('Reviewer:', reviewer.email);
  console.log('Student:', student.email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    // always release the connection pool when the script ends
    await prisma.$disconnect();
  });
