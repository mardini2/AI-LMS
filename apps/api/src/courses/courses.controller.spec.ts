import { Role } from '../common/enums/role.enum';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

describe('CoursesController', () => {
  const coursesService = {
    listStudentCourses: jest.fn(),
    listInstructorCourses: jest.fn(),
    listCourses: jest.fn(),
    createCourse: jest.fn(),
    assertStudentEnrollment: jest.fn(),
    getCourse: jest.fn(),
  } as unknown as CoursesService;

  let controller: CoursesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CoursesController(coursesService);
  });

  it('routes listCourses to student-specific query for students', async () => {
    (coursesService.listStudentCourses as jest.Mock).mockResolvedValue(['x']);
    const request = { user: { sub: 's1', role: Role.STUDENT } } as never;

    await expect(controller.listCourses(request)).resolves.toEqual(['x']);
    expect(coursesService.listStudentCourses).toHaveBeenCalledWith('s1');
  });

  it('routes listCourses to instructor-specific query for instructors', async () => {
    (coursesService.listInstructorCourses as jest.Mock).mockResolvedValue([
      'x',
    ]);
    const request = { user: { sub: 'i1', role: Role.INSTRUCTOR } } as never;

    await expect(controller.listCourses(request)).resolves.toEqual(['x']);
    expect(coursesService.listInstructorCourses).toHaveBeenCalledWith('i1');
  });

  it('routes listCourses to full listing for admin/reviewer', async () => {
    (coursesService.listCourses as jest.Mock).mockResolvedValue(['x']);
    const request = { user: { sub: 'a1', role: Role.ADMIN } } as never;

    await expect(controller.listCourses(request)).resolves.toEqual(['x']);
    expect(coursesService.listCourses).toHaveBeenCalled();
  });

  it('validates student enrollment before returning course details for students', async () => {
    (coursesService.getCourse as jest.Mock).mockResolvedValue({ id: 'c1' });
    const request = { user: { sub: 's1', role: Role.STUDENT } } as never;

    await expect(controller.getCourse('c1', request)).resolves.toEqual({
      id: 'c1',
    });
    expect(coursesService.assertStudentEnrollment).toHaveBeenCalledWith(
      'c1',
      's1',
    );
  });

  it('creates a course with the expected service arguments', async () => {
    (coursesService.createCourse as jest.Mock).mockResolvedValue({ id: 'c1' });
    const request = { user: { sub: 'u1', role: Role.INSTRUCTOR } } as never;

    await controller.createCourse(
      { title: 'New', description: 'D', backgroundImage: '/a.png' },
      request,
    );

    expect(coursesService.createCourse).toHaveBeenCalledWith(
      'u1',
      'New',
      'D',
      '/a.png',
    );
  });
});
