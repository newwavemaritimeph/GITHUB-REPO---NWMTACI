"use client";

import { useState } from "react";
import { DataTable, EmptyState, Field, Modal, Pill, SearchInput, useToast } from "@/components/ui/kit";
import { useSystem } from "@/lib/system/store";
import { PageHeader, Panel } from "./shared";

type InstructorDraft = { id: string | null; name: string; mobile: string; email: string; specialization: string; licenseNumber: string };
type ClassroomDraft = { id: string | null; name: string; capacity: string; instructor: string };

/** Training instructors / trainors with personal details. Managed by HR; the
 * schedule builder and classroom assignment pick from the active list. */
export function InstructorsModule() {
  const { state, addInstructor, updateInstructor, setInstructorActive } = useSystem();
  const toast = useToast();
  const [draft, setDraft] = useState<InstructorDraft | null>(null);

  return (
    <div className="page">
      <PageHeader
        eyebrow="People operations"
        title="Instructors"
        description="Trainors and their personal details. Active instructors are selectable when scheduling a batch or assigning a classroom."
        actions={
          <button className="primary-button" onClick={() => setDraft({ id: null, name: "", mobile: "", email: "", specialization: "", licenseNumber: "" })}>
            + New instructor
          </button>
        }
      />

      <Panel padded={false}>
        {state.instructors.length === 0 ? (
          <EmptyState icon="◎" title="No instructors yet" text="Add a trainor so they can be scheduled to a batch." />
        ) : (
          <DataTable columns={["Instructor", "Contact", "Specialization", "License no.", "Status", ""]} minWidth={940}>
            {state.instructors.map((instructor) => (
              <tr key={instructor.id} className={instructor.active ? "" : "row-muted"}>
                <td><strong>{instructor.name}</strong></td>
                <td>
                  {instructor.mobile || "—"}
                  <small>{instructor.email || "—"}</small>
                </td>
                <td>{instructor.specialization || "—"}</td>
                <td>{instructor.licenseNumber || "—"}</td>
                <td><Pill tone={instructor.active ? "green" : "slate"}>{instructor.active ? "Active" : "Archived"}</Pill></td>
                <td className="cell-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setDraft({ id: instructor.id, name: instructor.name, mobile: instructor.mobile, email: instructor.email, specialization: instructor.specialization, licenseNumber: instructor.licenseNumber })}
                  >
                    Edit
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setInstructorActive(instructor.id, !instructor.active);
                      toast("warning", `${instructor.name} ${instructor.active ? "archived" : "restored"}.`);
                    }}
                  >
                    {instructor.active ? "Archive" : "Restore"}
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "Edit instructor" : "New instructor"}
        description="Personal details are kept for scheduling and coordination."
        onClose={() => setDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!draft) return;
                const name = draft.name.trim();
                if (!name) {
                  toast("warning", "Instructor name is required.");
                  return;
                }
                const payload = { name, mobile: draft.mobile.trim(), email: draft.email.trim(), specialization: draft.specialization.trim(), licenseNumber: draft.licenseNumber.trim() };
                if (draft.id) {
                  updateInstructor(draft.id, payload);
                  toast("success", `${name} updated.`);
                } else {
                  addInstructor(payload);
                  toast("success", `${name} added.`);
                }
                setDraft(null);
              }}
            >
              {draft?.id ? "Save changes" : "Add instructor"}
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Full name*" full>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Mobile">
              <input value={draft.mobile} onChange={(event) => setDraft({ ...draft, mobile: event.target.value })} />
            </Field>
            <Field label="Email">
              <input value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </Field>
            <Field label="Specialization" hint="e.g. Deck, Engine, Safety & survival">
              <input value={draft.specialization} onChange={(event) => setDraft({ ...draft, specialization: event.target.value })} />
            </Field>
            <Field label="License / accreditation no.">
              <input value={draft.licenseNumber} onChange={(event) => setDraft({ ...draft, licenseNumber: event.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Physical training rooms with capacity. The schedule builder picks the batch
 * venue from the active list. */
export function ClassroomsModule() {
  const { state, addClassroom, updateClassroom, setClassroomActive } = useSystem();
  const toast = useToast();
  const [draft, setDraft] = useState<ClassroomDraft | null>(null);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Training delivery"
        title="Classrooms"
        description="Training rooms and their seating capacity. Active rooms are selectable as a batch venue."
        actions={
          <button className="primary-button" onClick={() => setDraft({ id: null, name: "", capacity: "", instructor: "" })}>
            + New classroom
          </button>
        }
      />

      <Panel padded={false}>
        {state.classrooms.length === 0 ? (
          <EmptyState icon="□" title="No classrooms yet" text="Add a room so batches can be assigned a venue." />
        ) : (
          <DataTable columns={["Classroom", "Capacity", "Instructor", "Status", ""]} minWidth={760}>
            {state.classrooms.map((classroom) => (
              <tr key={classroom.id} className={classroom.active ? "" : "row-muted"}>
                <td><strong>{classroom.name}</strong></td>
                <td>{classroom.capacity} seats</td>
                <td>{classroom.instructor || "—"}</td>
                <td><Pill tone={classroom.active ? "green" : "slate"}>{classroom.active ? "Active" : "Archived"}</Pill></td>
                <td className="cell-actions">
                  <button className="ghost-button" onClick={() => setDraft({ id: classroom.id, name: classroom.name, capacity: String(classroom.capacity), instructor: classroom.instructor ?? "" })}>
                    Edit
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setClassroomActive(classroom.id, !classroom.active);
                      toast("warning", `${classroom.name} ${classroom.active ? "archived" : "restored"}.`);
                    }}
                  >
                    {classroom.active ? "Archive" : "Restore"}
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "Edit classroom" : "New classroom"}
        description="Capacity guides batch seat limits."
        onClose={() => setDraft(null)}
        footer={
          <>
            <button className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="primary-button"
              onClick={() => {
                if (!draft) return;
                const name = draft.name.trim();
                const capacity = Math.max(0, Math.round(Number(draft.capacity)));
                if (!name || !(capacity > 0)) {
                  toast("warning", "Enter a room name and a capacity.");
                  return;
                }
                const instructor = draft.instructor.trim();
                if (draft.id) {
                  updateClassroom(draft.id, { name, capacity, instructor });
                  toast("success", `${name} updated.`);
                } else {
                  addClassroom({ name, capacity, instructor });
                  toast("success", `${name} added.`);
                }
                setDraft(null);
              }}
            >
              {draft?.id ? "Save changes" : "Add classroom"}
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Room name*" full hint="e.g. Room 301, Simulation Lab">
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Capacity (seats)*">
              <input type="number" min={1} step="1" value={draft.capacity} onChange={(event) => setDraft({ ...draft, capacity: event.target.value })} />
            </Field>
            <Field label="Instructor" hint="Assigned trainor. Instructors are managed in HR.">
              <input list="classroom-instructors" value={draft.instructor} onChange={(event) => setDraft({ ...draft, instructor: event.target.value })} placeholder="Select or type a name" />
              <datalist id="classroom-instructors">
                {state.instructors.filter((item) => item.active).map((item) => (
                  <option key={item.id} value={item.name} />
                ))}
              </datalist>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

type TemplateDraft = { id: string; code: string; course: string; instructionTemplate: string; certificateTemplate: string };

/** Training Operations setup: draft per-course training instructions and the
 * certificate template (add/edit/remove) for New Wave's own STCW & in-house
 * courses. Backed by the Course.instructionTemplate / certificateTemplate fields. */
export function TrainingSetupModule() {
  const { state, updateCourse } = useSystem();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<TemplateDraft | null>(null);

  const term = query.trim().toLowerCase();
  const courses = state.courses
    .filter((course) => course.active && `${course.code} ${course.course} ${course.category}`.toLowerCase().includes(term))
    .sort((a, b) => a.course.localeCompare(b.course));

  return (
    <div className="page">
      <PageHeader
        eyebrow="Training delivery"
        title="Training setup"
        description="Draft the training instructions and certificate template for each New Wave STCW / in-house course."
      />

      <Panel padded={false}>
        <div className="toolbar toolbar-wrap">
          <SearchInput value={query} onChange={setQuery} placeholder="Search course by name, code, or category" />
          <span className="toolbar-end catalog-count">{courses.length} course{courses.length === 1 ? "" : "s"}</span>
        </div>
        {courses.length === 0 ? (
          <EmptyState icon="◇" title="No courses match" text="Adjust the search term." />
        ) : (
          <DataTable columns={["Course", "Instructions", "Certificate template", ""]} minWidth={860}>
            {courses.map((course) => (
              <tr key={course.id}>
                <td>
                  <strong>{course.course}</strong>
                  <small>{course.code} · {course.category}</small>
                </td>
                <td><Pill tone={course.instructionTemplate ? "green" : "slate"}>{course.instructionTemplate ? "Drafted" : "Not set"}</Pill></td>
                <td><Pill tone={course.certificateTemplate ? "green" : "slate"}>{course.certificateTemplate ? "Set" : "Not set"}</Pill></td>
                <td className="cell-actions">
                  <button
                    className="ghost-button"
                    onClick={() => setDraft({ id: course.id, code: course.code, course: course.course, instructionTemplate: course.instructionTemplate ?? "", certificateTemplate: course.certificateTemplate ?? "" })}
                  >
                    Edit templates
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft ? `Templates — ${draft.course}` : "Templates"}
        description="Instructions are emailed to trainees on payment; the certificate template is used when the certificate is issued."
        onClose={() => setDraft(null)}
        wide
        footer={
          <>
            <button className="secondary-button" onClick={() => setDraft(null)}>Cancel</button>
            <button
              className="secondary-button ghost-danger"
              onClick={() => {
                if (!draft) return;
                updateCourse(draft.id, { instructionTemplate: "", certificateTemplate: "" });
                toast("warning", `${draft.course} templates cleared.`);
                setDraft(null);
              }}
            >
              Clear both
            </button>
            <button
              className="primary-button"
              onClick={() => {
                if (!draft) return;
                updateCourse(draft.id, { instructionTemplate: draft.instructionTemplate.trim(), certificateTemplate: draft.certificateTemplate.trim() });
                toast("success", `${draft.course} templates saved.`);
                setDraft(null);
              }}
            >
              Save templates
            </button>
          </>
        }
      >
        {draft && (
          <div className="form-grid">
            <Field label="Training instructions" full hint="Reporting details, requirements, and reminders emailed to the trainee.">
              <textarea rows={6} value={draft.instructionTemplate} onChange={(event) => setDraft({ ...draft, instructionTemplate: event.target.value })} />
            </Field>
            <Field label="Certificate template" full hint="Template reference / layout name used when issuing this course's certificate.">
              <input value={draft.certificateTemplate} onChange={(event) => setDraft({ ...draft, certificateTemplate: event.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
