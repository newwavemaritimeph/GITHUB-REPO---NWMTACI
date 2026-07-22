import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAdmissionPdf } from "@/lib/documents";

export const runtime="nodejs";
const one=<T,>(value:T|T[]|null|undefined):T|null=>Array.isArray(value)?value[0]??null:value??null;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await requireStaff()))return NextResponse.json({error:"Not authorized."},{status:403});
  const {id}=await params,db=createSupabaseAdminClient(),{data}=await db.from("enrollments").select("id,enrollment_number,trainees(trainee_number,registration_reference,legal_first_name,legal_middle_name,legal_last_name,suffix,address,birthdate,place_of_birth,email,mobile,srn,rank,company,emergency_contact,terms_version),courses(name),batches(batch_number,starts_on,ends_on,venue)").eq("id",id).maybeSingle();
  if(!data)return NextResponse.json({error:"Enrollment not found."},{status:404});const trainee=one(data.trainees),course=one(data.courses),batch=one(data.batches);if(!trainee)return NextResponse.json({error:"Trainee record is incomplete."},{status:409});const emergency=(trainee.emergency_contact??{}) as {name?:string;mobile?:string};
  const [template,terms]=await Promise.all([fetch(new URL("/document-templates/admission-form-reference.png",request.url)).then(r=>r.arrayBuffer()),fetch(new URL("/document-templates/terms-and-conditions.png",request.url)).then(r=>r.arrayBuffer())]);
  const bytes=await createAdmissionPdf({reference:trainee.registration_reference??data.enrollment_number,traineeNumber:trainee.trainee_number,firstName:trainee.legal_first_name,middleName:trainee.legal_middle_name??"",lastName:trainee.legal_last_name,suffix:trainee.suffix??"",address:trainee.address??"",birthDate:trainee.birthdate,placeOfBirth:trainee.place_of_birth??"",email:trainee.email,mobile:trainee.mobile,srn:trainee.srn??"",rank:trainee.rank??"",company:trainee.company??"",emergencyName:emergency.name??"",emergencyMobile:emergency.mobile??"",course:course?.name??"Training",schedule:batch?`${batch.starts_on} to ${batch.ends_on} - ${batch.batch_number}`:"Open schedule",venue:batch?.venue??"",termsVersion:trainee.terms_version??"Current"},new Uint8Array(template),new Uint8Array(terms));
  return new Response(bytes as BodyInit,{headers:{"content-type":"application/pdf","content-disposition":`inline; filename="${data.enrollment_number}-admission.pdf"`,"cache-control":"private, no-store"}});
}
