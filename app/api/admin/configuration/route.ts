import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("payment-method"),name:z.string().trim().min(2).max(80),requiresReference:z.boolean(),allowsProof:z.boolean()}),
  z.object({action:z.literal("marketing-agency"),name:z.string().trim().min(2).max(160),contactName:z.string().trim().max(160).optional(),email:z.string().email().optional().or(z.literal("")),mobile:z.string().trim().max(40).optional()}),
  z.object({action:z.literal("partner"),name:z.string().trim().min(2).max(160),email:z.string().email().optional().or(z.literal("")),mobile:z.string().trim().max(40).optional()}),
  z.object({action:z.literal("course"),id:z.string().uuid().optional(),code:z.string().trim().min(2).max(40),name:z.string().trim().min(2).max(240),categoryId:z.string().uuid(),deliveryType:z.enum(["In-House","Partner or Endorsed"]),durationLabel:z.string().trim().min(2).max(60),durationDays:z.number().positive().max(365),mode:z.string().trim().min(2).max(80),priceCentavos:z.number().int().nonnegative()}),
  z.object({action:z.literal("offer-rate"),id:z.string().uuid(),durationLabel:z.string().trim().min(2).max(60),trainingFeeCentavos:z.number().int().nonnegative(),rebateCentavos:z.number().int().nonnegative()}),
  z.object({action:z.literal("invite-user"),employeeId:z.string().uuid().optional(),completeName:z.string().trim().min(2).max(160),email:z.string().email(),roleCode:z.enum(["admin","registration","cashier","accounting","training_operations","hr","instructor"])}),
  z.object({action:z.literal("reset-password"),email:z.string().email()}),
  z.object({action:z.literal("set-user-role"),userId:z.string().uuid(),roleCode:z.enum(["admin","registration","cashier","accounting","training_operations","hr","instructor"])}),
  z.object({action:z.literal("grant-role-by-email"),email:z.string().email(),completeName:z.string().trim().max(160).optional(),roleCode:z.enum(["admin","registration","cashier","accounting","training_operations","hr","instructor"])}),
  z.object({action:z.literal("remove-user"),userId:z.string().uuid()}),
]);
const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50);

export async function GET(){const staff=await requireStaff(["admin"]);
  if(!staff){
    // Self-diagnostic: report who is signed in and what roles the DB actually
    // holds for them (read via service role so RLS can't hide the truth).
    let debug:{userId:string|null;email:string|null;roles:string[]}|undefined;
    try{
      const server=await createSupabaseServerClient();
      const {data:{user}}=await server.auth.getUser();
      if(user){
        const admin=createSupabaseAdminClient();
        const {data}=await admin.from("user_roles").select("roles(code)").eq("user_id",user.id);
        const roles=((data??[]) as {roles?:{code?:string}|{code?:string}[]|null}[]).flatMap(r=>{const rr=r.roles;return Array.isArray(rr)?rr.map(x=>x.code??""):rr?[rr.code??""]:[]}).filter(Boolean);
        debug={userId:user.id,email:user.email??null,roles};
      } else debug={userId:null,email:null,roles:[]};
    }catch{/* diagnostics are best-effort */}
    return NextResponse.json({error:"Admin access required.",debug},{status:403});
  }
  const db=createSupabaseAdminClient(),results=await Promise.all([db.from("payment_methods").select("*").order("sort_order"),db.from("marketing_agencies").select("*").order("name"),db.from("partner_centers").select("*").order("name"),db.from("courses").select("id,code,name,category_id,delivery_type,duration_label,duration_days,training_mode,standard_price_centavos,active").order("name"),db.from("partner_course_offers").select("id,course_id,partner_center_id,duration_label,training_fee_centavos,rebate_centavos,partner_payable_centavos,partner_centers(name),courses(name)").eq("active",true),db.from("course_categories").select("id,name").eq("active",true).order("sort_order"),db.from("employees").select("id,complete_name,position,work_email,profile_id,active").eq("active",true).order("complete_name"),db.from("profiles").select("id,email,complete_name,account_state").order("complete_name"),db.from("user_roles").select("user_id,roles(code)")]);const error=results.find(r=>r.error)?.error;if(error)return NextResponse.json({error:error.message},{status:500});
  const roleBy=new Map<string,string[]>();for(const ur of (results[8].data??[]) as {user_id:string;roles?:{code:string}|{code:string}[]|null}[]){const codes=Array.isArray(ur.roles)?ur.roles.map(r=>r.code):ur.roles?[ur.roles.code]:[];roleBy.set(ur.user_id,[...(roleBy.get(ur.user_id)??[]),...codes])}
  const empBy=new Map<string,string>();for(const e of (results[6].data??[]) as {profile_id?:string|null;position:string}[])if(e.profile_id)empBy.set(e.profile_id,e.position);
  const users=((results[7].data??[]) as {id:string;email:string;complete_name:string;account_state:string}[]).map(p=>({id:p.id,email:p.email,completeName:p.complete_name,accountState:p.account_state,roles:roleBy.get(p.id)??[],position:empBy.get(p.id)??null}));
  return NextResponse.json({paymentMethods:results[0].data,agencies:results[1].data,partners:results[2].data,courses:results[3].data,offers:results[4].data,categories:results[5].data,employees:results[6].data,users},{headers:{"cache-control":"no-store"}})}

export async function POST(request:Request){const staff=await requireStaff(["admin"]);if(!staff)return NextResponse.json({error:"Admin access required."},{status:403});try{const value=input.parse(await request.json()),db=createSupabaseAdminClient();let record:unknown,recordType=value.action;
  // Build auth-email redirects from the live request origin so links never fall back to localhost.
  const authRedirect=`${process.env.APP_BASE_URL??new URL(request.url).origin}/auth/callback?next=/portal`;
  if(value.action==="payment-method"){const {data,error}=await db.from("payment_methods").upsert({code:slug(value.name),name:value.name,requires_reference:value.requiresReference,allows_proof:value.allowsProof,active:true},{onConflict:"code"}).select().single();if(error)throw error;record=data}
  else if(value.action==="marketing-agency"){const {data,error}=await db.from("marketing_agencies").upsert({name:value.name,contact_name:value.contactName||null,email:value.email||null,mobile:value.mobile||null,active:true},{onConflict:"name"}).select().single();if(error)throw error;record=data}
  else if(value.action==="partner"){const {data,error}=await db.from("partner_centers").upsert({name:value.name,contact_details:{email:value.email||null,mobile:value.mobile||null},active:true},{onConflict:"name"}).select().single();if(error)throw error;record=data}
  else if(value.action==="course"){const payload={code:value.code.toUpperCase(),name:value.name,category_id:value.categoryId,delivery_type:value.deliveryType,duration_label:value.durationLabel,duration_days:value.durationDays,training_mode:value.mode,standard_price_centavos:value.priceCentavos,public_visible:value.deliveryType==="In-House",active:true};const query=value.id?db.from("courses").update(payload).eq("id",value.id):db.from("courses").insert(payload);const {data,error}=await query.select().single();if(error)throw error;record=data}
  else if(value.action==="offer-rate"){if(value.rebateCentavos>value.trainingFeeCentavos)throw new Error("Rebate cannot exceed the training fee.");const {data,error}=await db.from("partner_course_offers").update({duration_label:value.durationLabel,training_fee_centavos:value.trainingFeeCentavos,rebate_centavos:value.rebateCentavos,updated_at:new Date().toISOString()}).eq("id",value.id).select().single();if(error)throw error;record=data}
  else if(value.action==="reset-password"){const {error}=await db.auth.resetPasswordForEmail(value.email,{redirectTo:authRedirect});if(error)throw error;record={email:value.email,sent:true}}
  else if(value.action==="set-user-role"){const {data:role}=await db.from("roles").select("id").eq("code",value.roleCode).single();if(!role)throw new Error("Role not found.");const del=await db.from("user_roles").delete().eq("user_id",value.userId);if(del.error)throw del.error;const ins=await db.from("user_roles").insert({user_id:value.userId,role_id:role.id,assigned_by:staff.user.id});if(ins.error)throw ins.error;record={userId:value.userId,role:value.roleCode}}
  else if(value.action==="grant-role-by-email"){
    // Assign a portal role to an EXISTING Supabase Auth login by email — no email
    // delivery needed. The login itself (and its password) is created in Supabase.
    const {data:list,error:listErr}=await db.auth.admin.listUsers({perPage:1000});if(listErr)throw listErr;
    const authUser=list.users.find(u=>(u.email??"").toLowerCase()===value.email.toLowerCase());
    if(!authUser)throw new Error("No Supabase login exists for that email yet. Create it in Supabase → Authentication → Users first, then assign the role here.");
    const up=await db.from("profiles").upsert({id:authUser.id,email:value.email,complete_name:value.completeName||authUser.email,account_state:"Active"});if(up.error)throw up.error;
    const {data:role}=await db.from("roles").select("id").eq("code",value.roleCode).single();if(!role)throw new Error("Role not found.");
    const del=await db.from("user_roles").delete().eq("user_id",authUser.id);if(del.error)throw del.error;
    const ins=await db.from("user_roles").insert({user_id:authUser.id,role_id:role.id,assigned_by:staff.user.id});if(ins.error)throw ins.error;
    record={userId:authUser.id,email:value.email,role:value.roleCode}}
  else if(value.action==="remove-user"){
    // Revoke portal access (soft): strip roles and deactivate the profile. The
    // Supabase login is left intact — delete it in the dashboard if truly needed.
    if(value.userId===staff.user.id)throw new Error("You cannot remove your own account.");
    const del=await db.from("user_roles").delete().eq("user_id",value.userId);if(del.error)throw del.error;
    const upd=await db.from("profiles").update({account_state:"Deactivated"}).eq("id",value.userId);if(upd.error)throw upd.error;
    record={userId:value.userId,removed:true}}
  else {const invitation=await db.auth.admin.inviteUserByEmail(value.email,{data:{complete_name:value.completeName},redirectTo:authRedirect});if(invitation.error||!invitation.data.user)throw invitation.error??new Error("Account invitation failed.");const user=invitation.data.user;await db.from("profiles").upsert({id:user.id,email:value.email,complete_name:value.completeName,account_state:"Invited"});const {data:role}=await db.from("roles").select("id").eq("code",value.roleCode).single();if(!role)throw new Error("Role not found.");await db.from("user_roles").upsert({user_id:user.id,role_id:role.id,assigned_by:staff.user.id});if(value.employeeId)await db.from("employees").update({profile_id:user.id,work_email:value.email}).eq("id",value.employeeId);record={userId:user.id,email:value.email,role:value.roleCode}}
  await db.from("audit_logs").insert({actor_id:staff.user.id,actor_role:"admin",action:`configuration.${value.action}`,record_type:recordType,record_id:crypto.randomUUID(),new_values:record});return NextResponse.json({ok:true,record});
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Configuration could not be saved."},{status:400})}}
