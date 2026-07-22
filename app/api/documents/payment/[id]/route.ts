import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAcknowledgmentReceiptPdf, createPaymentInvoicePdf } from "@/lib/documents";

export const runtime="nodejs";
const one=<T,>(value:T|T[]|null|undefined):T|null=>Array.isArray(value)?value[0]??null:value??null;

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  if(!(await requireStaff(["admin","cashier","accounting","registration"])))return NextResponse.json({error:"Not authorized."},{status:403});
  const {id}=await params,type=new URL(request.url).searchParams.get("type")==="receipt"?"receipt":"invoice",db=createSupabaseAdminClient();
  const {data:payment}=await db.from("payments").select("id,payment_number,amount_centavos,method,reference_number,received_at,cashier_id,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,address)").eq("id",id).maybeSingle();
  if(!payment)return NextResponse.json({error:"Payment not found."},{status:404});
  const [{data:allocation},{data:receipt},{data:invoice},{data:cashier}]=await Promise.all([
    db.from("payment_allocations").select("enrollment_id,amount_centavos,enrollments(enrollment_number,selling_price_centavos,courses(name))").eq("payment_id",id).limit(1).maybeSingle(),
    db.from("receipts").select("receipt_number,snapshot").eq("payment_id",id).maybeSingle(),
    db.from("invoices").select("invoice_number,snapshot").eq("payment_id",id).maybeSingle(),
    db.from("profiles").select("complete_name").eq("id",payment.cashier_id).maybeSingle(),
  ]);
  if(!allocation||!receipt||!invoice)return NextResponse.json({error:"Payment documents are still being prepared."},{status:409});
  const trainee=one(payment.trainees),enrollment=one(allocation.enrollments),course=one(enrollment?.courses),snapshot=receipt.snapshot as Record<string,unknown>;
  const document={invoiceNumber:invoice.invoice_number,receiptNumber:receipt.receipt_number,paymentNumber:payment.payment_number,enrollmentNumber:enrollment?.enrollment_number??"-",traineeName:[trainee?.legal_first_name,trainee?.legal_middle_name,trainee?.legal_last_name,trainee?.suffix].filter(Boolean).join(" "),traineeNumber:trainee?.trainee_number??"-",address:trainee?.address??"",course:course?.name??"Training",amountCentavos:Number(payment.amount_centavos),totalDueCentavos:Number(enrollment?.selling_price_centavos??0),totalPaidCentavos:Number(snapshot.total_paid_centavos??payment.amount_centavos),balanceCentavos:Number(snapshot.balance_centavos??0),method:payment.method,referenceNumber:payment.reference_number??"",receivedAt:payment.received_at,cashierName:cashier?.complete_name??"Authorized Cashier"};
  let bytes:Uint8Array,filename:string;
  if(type==="receipt"){const template=await fetch(new URL("/document-templates/acknowledgment-receipt-reference.png",request.url)).then(response=>response.arrayBuffer());bytes=await createAcknowledgmentReceiptPdf(document,new Uint8Array(template));filename=`${receipt.receipt_number}-acknowledgment-receipt.pdf`}else{bytes=await createPaymentInvoicePdf(document);filename=`${invoice.invoice_number}-invoice.pdf`}
  return new Response(bytes as BodyInit,{headers:{"content-type":"application/pdf","content-disposition":`inline; filename="${filename}"`,"cache-control":"private, no-store"}});
}
