import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { withAuthTimeout } from "@/lib/supabase/config";

// The seven portal roles (owner, 9 Oct 2026).
const ROLE_CODES=z.enum(["admin","registration","cashier","accounting","releasing_officer","mismo_officer","admin_assistant"]);
const ROLE_NAMES:Record<string,string>={admin:"Admin",registration:"Registration",cashier:"Cashier",accounting:"Accounting",releasing_officer:"Releasing Officer",mismo_officer:"MISMO Compliance Officer",admin_assistant:"Admin Assistant"};
const input=z.discriminatedUnion("action",[
  z.object({action:z.literal("payment-method"),name:z.string().trim().min(2).max(80),requiresReference:z.boolean(),allowsProof:z.boolean()}),
  z.object({action:z.literal("marketing-agency"),name:z.string().trim().min(2).max(160),contactName:z.string().trim().max(160).optional(),email:z.string().email().optional().or(z.literal("")),mobile:z.string().trim().max(40).optional()}),
  z.object({action:z.literal("partner"),name:z.string().trim().min(2).max(160),email:z.string().email().optional().or(z.literal("")),mobile:z.string().trim().max(40).optional()}),
  z.object({action:z.literal("course"),id:z.string().uuid().optional(),code:z.string().trim().min(2).max(40),name:z.string().trim().min(2).max(240),categoryId:z.string().uuid(),deliveryType:z.enum(["In-House","Partner or Endorsed"]),durationLabel:z.string().trim().min(2).max(60),durationDays:z.number().positive().max(365),mode:z.string().trim().min(2).max(80),priceCentavos:z.number().int().nonnegative()}),
  z.object({action:z.literal("offer-rate"),id:z.string().uuid(),durationLabel:z.string().trim().min(2).max(60),trainingFeeCentavos:z.number().int().nonnegative(),rebateCentavos:z.number().int().nonnegative()}),
  z.object({action:z.literal("invite-user"),employeeId:z.string().uuid().optional(),completeName:z.string().trim().min(2).max(160),email:z.string().email(),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional()}),
  z.object({action:z.literal("reset-password"),email:z.string().email()}),
  z.object({action:z.literal("set-user-role"),userId:z.string().uuid(),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional()}),
  z.object({action:z.literal("grant-role-by-email"),email:z.string().email(),completeName:z.string().trim().max(160).optional(),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional()}),
  z.object({action:z.literal("remove-user"),userId:z.string().uuid()}),
  z.object({action:z.literal("update-user"),userId:z.string().uuid(),completeName:z.string().trim().min(2).max(160),position:z.string().trim().max(120).optional(),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional()}),
  z.object({action:z.literal("set-password"),userId:z.string().uuid(),password:z.string().min(8).max(200)}),
  z.object({action:z.literal("delete-user"),userId:z.string().uuid()}),
  z.object({action:z.literal("restore-user"),userId:z.string().uuid(),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional()}),
  z.object({action:z.literal("create-user"),email:z.string().email(),password:z.string().min(6).max(200),completeName:z.string().trim().min(2).max(160),roleCode:ROLE_CODES,secondRoleCode:ROLE_CODES.nullable().optional(),position:z.string().trim().max(120).optional()}),
]);
const slug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,50);

export async function GET(){const staff=await requireStaff(["admin"]);
  if(!staff){
    // Self-diagnostic: report which cookies the route received, who is signed
    // in, and what roles the DB actually holds (read via service role so RLS
    // can't hide the truth). Surfaces whether the failure is session vs role.
    let debug:{userId:string|null;email:string|null;roles:string[];totalCookies:number;authCookies:string[]}|undefined;
    try{
      const jar=await cookies();
      const names=jar.getAll().map(c=>c.name);
      const authCookies=names.filter(n=>n.startsWith("sb-")||n.includes("auth-token"));
      const server=await createSupabaseServerClient();
      const user=(await withAuthTimeout(server.auth.getUser()))?.data.user;
      let userId:string|null=null,email:string|null=null,roles:string[]=[];
      if(user){
        userId=user.id;email=user.email??null;
        const admin=createSupabaseAdminClient();
        const {data}=await admin.from("user_roles").select("roles(code)").eq("user_id",user.id);
        roles=((data??[]) as {roles?:{code?:string}|{code?:string}[]|null}[]).flatMap(r=>{const rr=r.roles;return Array.isArray(rr)?rr.map(x=>x.code??""):rr?[rr.code??""]:[]}).filter(Boolean);
      }
      debug={userId,email,roles,totalCookies:names.length,authCookies};
    }catch{/* diagnostics are best-effort */}
    return NextResponse.json({error:"Admin access required.",debug},{status:403});
  }
  const db=createSupabaseAdminClient(),results=await Promise.all([db.from("payment_methods").select("*").order("sort_order"),db.from("marketing_agencies").select("*").order("name"),db.from("partner_centers").select("*").order("name"),db.from("courses").select("id,code,name,category_id,delivery_type,duration_label,duration_days,training_mode,standard_price_centavos,active").order("name"),db.from("partner_course_offers").select("id,course_id,partner_center_id,duration_label,training_fee_centavos,rebate_centavos,partner_payable_centavos,partner_centers(name),courses(name)").eq("active",true),db.from("course_categories").select("id,name").eq("active",true).order("sort_order"),db.from("employees").select("id,complete_name,position,work_email,profile_id,active").eq("active",true).order("complete_name"),db.from("profiles").select("id,email,complete_name,account_state").order("complete_name"),db.from("user_roles").select("user_id,roles(code)")]);const error=results.find(r=>r.error)?.error;if(error)return NextResponse.json({error:error.message},{status:500});
  const roleBy=new Map<string,string[]>();for(const ur of (results[8].data??[]) as {user_id:string;roles?:{code:string}|{code:string}[]|null}[]){const codes=Array.isArray(ur.roles)?ur.roles.map(r=>r.code):ur.roles?[ur.roles.code]:[];roleBy.set(ur.user_id,[...(roleBy.get(ur.user_id)??[]),...codes])}
  const empBy=new Map<string,string>();for(const e of (results[6].data??[]) as {profile_id?:string|null;position:string}[])if(e.profile_id)empBy.set(e.profile_id,e.position);
  const users=((results[7].data??[]) as {id:string;email:string;complete_name:string;account_state:string}[]).map(p=>({id:p.id,email:p.email,completeName:p.complete_name,accountState:p.account_state,roles:roleBy.get(p.id)??[],position:empBy.get(p.id)??null}));
  return NextResponse.json({paymentMethods:results[0].data,agencies:results[1].data,partners:results[2].data,courses:results[3].data,offers:results[4].data,categories:results[5].data,employees:results[6].data,users},{headers:{"cache-control":"no-store"}})}

/** Replace a user's portal roles with up to two (owner, 9 Oct 2026: an employee may hold two roles). */
async function setRoles(db:ReturnType<typeof createSupabaseAdminClient>,userId:string,codes:(string|null|undefined)[],actor:string){
  const wanted=[...new Set(codes.filter((c):c is string=>!!c))].slice(0,2);
  if(!wanted.length)throw new Error("Choose a role.");
  let {data:roles,error}=await db.from("roles").select("id,code,active").in("code",wanted);if(error)throw error;
  // A role row may be missing (its migration not run yet) or switched off: the
  // seven portal roles are always allowed, so create or reactivate them here.
  const missing=wanted.filter(code=>!(roles??[]).some(r=>r.code===code&&r.active));
  if(missing.length){
    const up=await db.from("roles").upsert(missing.map(code=>({code,name:ROLE_NAMES[code]??code,is_staff:true,active:true})),{onConflict:"code"});if(up.error)throw up.error;
    ({data:roles,error}=await db.from("roles").select("id,code,active").in("code",wanted));if(error)throw error;
  }
  if((roles??[]).length!==wanted.length)throw new Error("Role not found.");
  const del=await db.from("user_roles").delete().eq("user_id",userId);if(del.error)throw del.error;
  const ins=await db.from("user_roles").insert((roles??[]).map(r=>({user_id:userId,role_id:r.id,assigned_by:actor})));if(ins.error)throw ins.error;
  return wanted;
}
export async function POST(request:Request){const staff=await requireStaff(["admin"]);if(!staff)return NextResponse.json({error:"Admin access required."},{status:403});try{const value=input.parse(await request.json()),db=createSupabaseAdminClient();let record:unknown,recordType=value.action;
  // Build auth-email redirects from the live request origin so links never fall back to localhost.
  const authRedirect=`${process.env.APP_BASE_URL??new URL(request.url).origin}/auth/callback?next=/portal`;
  if(value.action==="payment-method"){const {data,error}=await db.from("payment_methods").upsert({code:slug(value.name),name:value.name,requires_reference:value.requiresReference,allows_proof:value.allowsProof,active:true},{onConflict:"code"}).select().single();if(error)throw error;record=data}
  else if(value.action==="marketing-agency"){const {data,error}=await db.from("marketing_agencies").upsert({name:value.name,contact_name:value.contactName||null,email:value.email||null,mobile:value.mobile||null,active:true},{onConflict:"name"}).select().single();if(error)throw error;record=data}
  else if(value.action==="partner"){const {data,error}=await db.from("partner_centers").upsert({name:value.name,contact_details:{email:value.email||null,mobile:value.mobile||null},active:true},{onConflict:"name"}).select().single();if(error)throw error;record=data}
  else if(value.action==="course"){const payload={code:value.code.toUpperCase(),name:value.name,category_id:value.categoryId,delivery_type:value.deliveryType,duration_label:value.durationLabel,duration_days:value.durationDays,training_mode:value.mode,standard_price_centavos:value.priceCentavos,public_visible:value.deliveryType==="In-House",active:true};const query=value.id?db.from("courses").update(payload).eq("id",value.id):db.from("courses").insert(payload);const {data,error}=await query.select().single();if(error)throw error;record=data}
  else if(value.action==="offer-rate"){if(value.rebateCentavos>value.trainingFeeCentavos)throw new Error("Rebate cannot exceed the training fee.");const {data,error}=await db.from("partner_course_offers").update({duration_label:value.durationLabel,training_fee_centavos:value.trainingFeeCentavos,rebate_centavos:value.rebateCentavos,updated_at:new Date().toISOString()}).eq("id",value.id).select().single();if(error)throw error;record=data}
  else if(value.action==="reset-password"){const {error}=await db.auth.resetPasswordForEmail(value.email,{redirectTo:authRedirect});if(error)throw error;record={email:value.email,sent:true}}
  else if(value.action==="set-user-role"){const roles=await setRoles(db,value.userId,[value.roleCode,value.secondRoleCode],staff.user.id);record={userId:value.userId,roles}}
  else if(value.action==="grant-role-by-email"){
    // Assign a portal role to an EXISTING Supabase Auth login by email — no email
    // delivery needed. The login itself (and its password) is created in Supabase.
    const {data:list,error:listErr}=await db.auth.admin.listUsers({perPage:1000});if(listErr)throw listErr;
    const authUser=list.users.find(u=>(u.email??"").toLowerCase()===value.email.toLowerCase());
    if(!authUser)throw new Error("No Supabase login exists for that email yet. Create it in Supabase → Authentication → Users first, then assign the role here.");
    const up=await db.from("profiles").upsert({id:authUser.id,email:value.email,complete_name:value.completeName||authUser.email,account_state:"Active"});if(up.error)throw up.error;
    const roles=await setRoles(db,authUser.id,[value.roleCode,value.secondRoleCode],staff.user.id);
    record={userId:authUser.id,email:value.email,roles}}
  else if(value.action==="create-user"){
    // Create the Supabase Auth login AND the portal profile/role in one step,
    // server-side via the service role. The plaintext password is used only to
    // create the account (Supabase stores a hash) and is never persisted or
    // logged by this app.
    // A deleted account (owner, 9 Oct 2026) can be registered again with the same
    // email: its login is reopened with the new password, name and roles. The
    // login is never erased, so payments and audit entries keep their author.
    const pattern=value.email.trim().replace(/[\\%_]/g,m=>"\\"+m);
    const {data:prior}=await db.from("profiles").select("id,account_state").ilike("email",pattern).limit(1).maybeSingle();
    if(prior&&prior.account_state!=="Deactivated")throw new Error("That email already has an account. Use Edit on its row to change the roles.");
    let uid=prior?.id as string|undefined;
    if(!uid){
      const created=await db.auth.admin.createUser({email:value.email,password:value.password,email_confirm:true,user_metadata:{complete_name:value.completeName}});
      if(created.data.user)uid=created.data.user.id;
      else if(created.error?.message?.includes("registered")){
        // A login without a portal profile: find it and reuse it.
        for(let page=1;page<=20&&!uid;page++){const list=await db.auth.admin.listUsers({page,perPage:1000});if(list.error)throw list.error;uid=list.data.users.find(u=>u.email?.toLowerCase()===value.email.trim().toLowerCase())?.id;if(list.data.users.length<1000)break}
        if(!uid)throw new Error("That email already has a login that could not be found.");
      }
      else throw new Error(created.error?.message??"Could not create the account.");
    }
    const reopen=await db.auth.admin.updateUserById(uid,{password:value.password,ban_duration:"none",email_confirm:true,user_metadata:{complete_name:value.completeName}});if(reopen.error)throw reopen.error;
    const up=await db.from("profiles").upsert({id:uid,email:value.email,complete_name:value.completeName,account_state:"Active"});if(up.error)throw up.error;
    await setRoles(db,uid,[value.roleCode,value.secondRoleCode],staff.user.id);
    const {data:priorEmp}=await db.from("employees").select("id").eq("profile_id",uid).limit(1).maybeSingle();
    if(priorEmp){await db.from("employees").update({complete_name:value.completeName,...(value.position?{position:value.position}:{})}).eq("id",priorEmp.id)}
    else if(value.position){
      const {data:employeeNumber,error:numErr}=await db.rpc("next_reference",{prefix:"EMP",requested_year:new Date().getFullYear()});
      if(numErr)throw numErr;
      const emp=await db.from("employees").insert({profile_id:uid,employee_number:employeeNumber,complete_name:value.completeName,position:value.position,date_hired:new Date().toISOString().slice(0,10),pay_type:"Monthly",work_email:value.email});
      if(emp.error)throw emp.error;
    }
    record={userId:uid,email:value.email,roles:[value.roleCode,value.secondRoleCode].filter(Boolean)};
  }
  else if(value.action==="update-user"){
    // Edit an employee account: name, position and portal role.
    const up=await db.from("profiles").update({complete_name:value.completeName}).eq("id",value.userId);if(up.error)throw up.error;
    if(value.userId===staff.user.id&&![value.roleCode,value.secondRoleCode].some(c=>c==="admin"))throw new Error("You cannot remove your own Admin role.");
    await setRoles(db,value.userId,[value.roleCode,value.secondRoleCode],staff.user.id);
    if(value.position!==undefined){const {data:emp}=await db.from("employees").select("id").eq("profile_id",value.userId).maybeSingle();if(emp)await db.from("employees").update({position:value.position||"Staff",complete_name:value.completeName}).eq("id",emp.id)}
    await db.auth.admin.updateUserById(value.userId,{user_metadata:{complete_name:value.completeName}});
    record={userId:value.userId,completeName:value.completeName,roles:[value.roleCode,value.secondRoleCode].filter(Boolean)}}
  else if(value.action==="set-password"){
    // The Admin sets a temporary password for the employee. It goes straight to
    // Supabase Auth (stored as a hash) and is never saved or logged by the portal.
    const {error}=await db.auth.admin.updateUserById(value.userId,{password:value.password});if(error)throw error;
    record={userId:value.userId,passwordReset:true}}
  else if(value.action==="delete-user"){
    // Delete an employee account from the portal: roles removed, profile
    // deactivated, sign-in blocked. Records they created (payments, audit
    // entries) stay, so the history remains complete.
    if(value.userId===staff.user.id)throw new Error("You cannot delete your own account.");
    const del=await db.from("user_roles").delete().eq("user_id",value.userId);if(del.error)throw del.error;
    const upd=await db.from("profiles").update({account_state:"Deactivated"}).eq("id",value.userId);if(upd.error)throw upd.error;
    const ban=await db.auth.admin.updateUserById(value.userId,{ban_duration:"876000h"});if(ban.error)throw ban.error;
    record={userId:value.userId,deleted:true}}
  else if(value.action==="restore-user"){
    await setRoles(db,value.userId,[value.roleCode,value.secondRoleCode],staff.user.id);
    const upd=await db.from("profiles").update({account_state:"Active"}).eq("id",value.userId);if(upd.error)throw upd.error;
    const unban=await db.auth.admin.updateUserById(value.userId,{ban_duration:"none"});if(unban.error)throw unban.error;
    record={userId:value.userId,restored:true}}
  else if(value.action==="remove-user"){
    // Revoke portal access (soft): strip roles and deactivate the profile. The
    // Supabase login is left intact — delete it in the dashboard if truly needed.
    if(value.userId===staff.user.id)throw new Error("You cannot remove your own account.");
    const del=await db.from("user_roles").delete().eq("user_id",value.userId);if(del.error)throw del.error;
    const upd=await db.from("profiles").update({account_state:"Deactivated"}).eq("id",value.userId);if(upd.error)throw upd.error;
    record={userId:value.userId,removed:true}}
  else {const invitation=await db.auth.admin.inviteUserByEmail(value.email,{data:{complete_name:value.completeName},redirectTo:authRedirect});if(invitation.error||!invitation.data.user)throw invitation.error??new Error("Account invitation failed.");const user=invitation.data.user;await db.from("profiles").upsert({id:user.id,email:value.email,complete_name:value.completeName,account_state:"Invited"});await setRoles(db,user.id,[value.roleCode,value.secondRoleCode],staff.user.id);if(value.employeeId)await db.from("employees").update({profile_id:user.id,work_email:value.email}).eq("id",value.employeeId);record={userId:user.id,email:value.email,role:value.roleCode}}
  await db.from("audit_logs").insert({actor_id:staff.user.id,actor_role:"admin",action:`configuration.${value.action}`,record_type:recordType,record_id:crypto.randomUUID(),new_values:record});return NextResponse.json({ok:true,record});
}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Configuration could not be saved."},{status:400})}}
