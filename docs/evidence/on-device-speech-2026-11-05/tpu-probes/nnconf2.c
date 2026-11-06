// Conformer-shaped encoder on the EdgeTPU: L resident layer models (25M int8 weights each), chained by burst.
#include <android/NeuralNetworks.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
static double now(){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1e3+t.tv_nsec/1e6;}
#define CK(x) do{int r_=(x);if(r_){printf("FAIL %s = %d (line %d)\n",#x,r_,__LINE__);fflush(stdout);exit(3);}}while(0)
static unsigned long long st=88172645463325252ULL;static inline unsigned rnd(){st^=st<<13;st^=st>>7;st^=st<<17;return (unsigned)(st>>32);}
static long memavail(){FILE*f=fopen("/proc/meminfo","r");char l[128];long v=0;while(fgets(l,128,f))if(sscanf(l,"MemAvailable: %ld",&v)==1)break;fclose(f);return v/1024;}
#define Q ANEURALNETWORKS_TENSOR_QUANT8_ASYMM_SIGNED
static ANeuralNetworksModel*M;static uint32_t idx;static int nops;static int optype[128];
static uint32_t T(int r,uint32_t a,uint32_t b,uint32_t c,float s,int z){uint32_t d[3]={a,b,c};ANeuralNetworksOperandType t={Q,r,d,s,z};CK(ANeuralNetworksModel_addOperand(M,&t));return idx++;}
static uint32_t scalarI(int v){ANeuralNetworksOperandType t={ANEURALNETWORKS_INT32,0,0,0,0};CK(ANeuralNetworksModel_addOperand(M,&t));CK(ANeuralNetworksModel_setOperandValue(M,idx,&v,4));return idx++;}
static uint32_t scalarB(int v){ANeuralNetworksOperandType t={ANEURALNETWORKS_BOOL,0,0,0,0};uint8_t b=v;CK(ANeuralNetworksModel_addOperand(M,&t));CK(ANeuralNetworksModel_setOperandValue(M,idx,&b,1));return idx++;}
static uint32_t scalarF(float v){ANeuralNetworksOperandType t={ANEURALNETWORKS_FLOAT32,0,0,0,0};CK(ANeuralNetworksModel_addOperand(M,&t));CK(ANeuralNetworksModel_setOperandValue(M,idx,&v,4));return idx++;}
static uint32_t vecI(const int32_t*v,int n){uint32_t d[1]={n};ANeuralNetworksOperandType t={ANEURALNETWORKS_TENSOR_INT32,1,d,0,0};int32_t*c=malloc(n*4);memcpy(c,v,n*4);CK(ANeuralNetworksModel_addOperand(M,&t));CK(ANeuralNetworksModel_setOperandValue(M,idx,c,n*4));return idx++;}
static void OP(int type,int ni,uint32_t*in,int no,uint32_t*out){optype[nops++]=type;CK(ANeuralNetworksModel_addOperation(M,type,ni,in,no,out));}
static const float SA=0.05f,SW=0.02f;static int N;static void*HW[64];static int nhw;
static uint32_t FC(uint32_t x,int K,int F,int relu){
 size_t n=(size_t)K*F;signed char*w=malloc(n);for(size_t i=0;i<n;i++)w[i]=(signed char)(rnd()%5)-2;HW[nhw++]=w;
 uint32_t d[2]={F,K};ANeuralNetworksOperandType tw={Q,2,d,SW,0};CK(ANeuralNetworksModel_addOperand(M,&tw));CK(ANeuralNetworksModel_setOperandValue(M,idx,w,n));uint32_t W=idx++;
 uint32_t db[1]={F};ANeuralNetworksOperandType tb={ANEURALNETWORKS_TENSOR_INT32,1,db,SA*SW,0};int32_t*b=calloc(F,4);CK(ANeuralNetworksModel_addOperand(M,&tb));CK(ANeuralNetworksModel_setOperandValue(M,idx,b,F*4));uint32_t B=idx++;
 uint32_t a=scalarI(relu?ANEURALNETWORKS_FUSED_RELU:ANEURALNETWORKS_FUSED_NONE),o=T(2,N,F,0,SA,0);uint32_t in[4]={x,W,B,a},out[1]={o};OP(ANEURALNETWORKS_FULLY_CONNECTED,4,in,1,out);return o;}
static uint32_t ADD(uint32_t a,uint32_t b,int F){uint32_t c=scalarI(0),o=T(2,N,F,0,SA,0),in[3]={a,b,c},out[1]={o};OP(ANEURALNETWORKS_ADD,3,in,1,out);return o;}
static uint32_t MUL(uint32_t a,uint32_t b,int F,float s,int z){uint32_t c=scalarI(0),o=T(2,N,F,0,s,z),in[3]={a,b,c},out[1]={o};OP(ANEURALNETWORKS_MUL,3,in,1,out);return o;}
static uint32_t SIG(uint32_t a,int F){uint32_t o=T(2,N,F,0,1.f/256,-128),in[1]={a},out[1]={o};OP(ANEURALNETWORKS_LOGISTIC,1,in,1,out);return o;}
static uint32_t heads(uint32_t x){int32_t sh[3]={N,8,128};uint32_t s=vecI(sh,3),r=T(3,N,8,128,SA,0),i1[2]={x,s},o1[1]={r};OP(ANEURALNETWORKS_RESHAPE,2,i1,1,o1);int32_t pm[3]={1,0,2};uint32_t p=vecI(pm,3),t=T(3,8,N,128,SA,0),i2[2]={r,p},o2[1]={t};OP(ANEURALNETWORKS_TRANSPOSE,2,i2,1,o2);return t;}
static uint32_t layer(uint32_t x){
 uint32_t h=FC(x,1024,4096,1),y=FC(h,4096,1024,0),x1=ADD(x,y,1024);
 uint32_t q=heads(FC(x1,1024,1024,0)),k=heads(FC(x1,1024,1024,0)),v=heads(FC(x1,1024,1024,0));uint32_t pos=FC(x1,1024,1024,0);(void)pos;
 uint32_t f0=scalarB(0),f1=scalarB(1),sc=T(3,8,N,N,0.25f,0),i3[4]={q,k,f0,f1},o3[1]={sc};OP(ANEURALNETWORKS_BATCH_MATMUL,4,i3,1,o3);
 uint32_t beta=scalarF(0.1f),pr=T(3,8,N,N,1.f/256,-128),i4[2]={sc,beta},o4[1]={pr};OP(ANEURALNETWORKS_SOFTMAX,2,i4,1,o4);
 uint32_t cx=T(3,8,N,128,SA,0),f2=scalarB(0),f3=scalarB(0),i5[4]={pr,v,f2,f3},o5[1]={cx};OP(ANEURALNETWORKS_BATCH_MATMUL,4,i5,1,o5);
 int32_t pm[3]={1,0,2};uint32_t p=vecI(pm,3),ct=T(3,N,8,128,SA,0),i6[2]={cx,p},o6[1]={ct};OP(ANEURALNETWORKS_TRANSPOSE,2,i6,1,o6);
 int32_t sh[2]={N,1024};uint32_t s=vecI(sh,2),cf=T(2,N,1024,0,SA,0),i7[2]={ct,s},o7[1]={cf};OP(ANEURALNETWORKS_RESHAPE,2,i7,1,o7);
 uint32_t x2=ADD(x1,FC(cf,1024,1024,0),1024);
 uint32_t a=FC(x2,1024,1024,0),g=SIG(FC(x2,1024,1024,0),1024),gl=MUL(a,g,1024,SA,0);
 int32_t s4[4]={1,N,1,1024};uint32_t sv=vecI(s4,4);uint32_t d4[4]={1,N,1,1024};ANeuralNetworksOperandType t4={Q,4,d4,SA,0};CK(ANeuralNetworksModel_addOperand(M,&t4));uint32_t r4=idx++;uint32_t i8[2]={gl,sv},o8[1]={r4};OP(ANEURALNETWORKS_RESHAPE,2,i8,1,o8);
 size_t dn=9*1024;signed char*dw=malloc(dn);for(size_t i=0;i<dn;i++)dw[i]=(signed char)(rnd()%5)-2;uint32_t dd[4]={1,9,1,1024};ANeuralNetworksOperandType tdw={Q,4,dd,SW,0};CK(ANeuralNetworksModel_addOperand(M,&tdw));CK(ANeuralNetworksModel_setOperandValue(M,idx,dw,dn));uint32_t DW=idx++;
 uint32_t db[1]={1024};ANeuralNetworksOperandType tb={ANEURALNETWORKS_TENSOR_INT32,1,db,SA*SW,0};int32_t*bz=calloc(1024,4);CK(ANeuralNetworksModel_addOperand(M,&tb));CK(ANeuralNetworksModel_setOperandValue(M,idx,bz,4096));uint32_t DB=idx++;
 uint32_t pad[11];pad[0]=r4;pad[1]=DW;pad[2]=DB;pad[3]=scalarI(0);pad[4]=scalarI(0);pad[5]=scalarI(4);pad[6]=scalarI(4);pad[7]=scalarI(1);pad[8]=scalarI(1);pad[9]=scalarI(1);pad[10]=scalarI(0);
 ANeuralNetworksOperandType t5={Q,4,d4,SA,0};CK(ANeuralNetworksModel_addOperand(M,&t5));uint32_t dc=idx++;uint32_t o9[1]={dc};OP(ANEURALNETWORKS_DEPTHWISE_CONV_2D,11,pad,1,o9);
 int32_t s2[2]={N,1024};uint32_t sv2=vecI(s2,2),d2=T(2,N,1024,0,SA,0),i10[2]={dc,sv2},o10[1]={d2};OP(ANEURALNETWORKS_RESHAPE,2,i10,1,o10);
 uint32_t si=MUL(d2,SIG(d2,1024),1024,SA,0);uint32_t x3=ADD(x2,FC(si,1024,1024,0),1024);
 uint32_t h2=FC(x3,1024,4096,1),y2=FC(h2,4096,1024,0);return ADD(x3,y2,1024);}
int main(int ac,char**av){N=ac>1?atoi(av[1]):64;int L=ac>2?atoi(av[2]):1;int R=ac>3?atoi(av[3]):30;
 uint32_t n=0;ANeuralNetworks_getDeviceCount(&n);ANeuralNetworksDevice*tpu=NULL;for(uint32_t i=0;i<n;i++){ANeuralNetworksDevice*d;ANeuralNetworks_getDevice(i,&d);const char*nm;ANeuralNetworksDevice_getName(d,&nm);if(strstr(nm,"edgetpu"))tpu=d;}
 if(!tpu)return 2;const ANeuralNetworksDevice*ds[1]={tpu};
 ANeuralNetworksCompilation*C[24];ANeuralNetworksBurst*B[24];ANeuralNetworksExecution*E[24];
 size_t sz=(size_t)N*1024;signed char*buf[2]={malloc(sz),malloc(sz)};for(size_t i=0;i<sz;i++)buf[0][i]=(signed char)(rnd()%17)-8;
 printf("N=%d L=%d memAvail start %ldMB\n",N,L,memavail());fflush(stdout);
 for(int l=0;l<L;l++){
  if(memavail()<1300){printf("WATCHDOG stop at layer %d memAvail %ldMB\n",l,memavail());L=l;break;}
  CK(ANeuralNetworksModel_create(&M));idx=0;nops=0;uint32_t x=T(2,N,1024,0,SA,0),o=layer(x);uint32_t ins[1]={x},outs[1]={o};
  CK(ANeuralNetworksModel_identifyInputsAndOutputs(M,1,ins,1,outs));CK(ANeuralNetworksModel_finish(M));
  if(l==0){bool sup[128]={0};CK(ANeuralNetworksModel_getSupportedOperationsForDevices(M,ds,1,sup));int ok=0;for(int i=0;i<nops;i++){ok+=sup[i];if(!sup[i])printf(" unsupported op %d type %d\n",i,optype[i]);}printf("ops supported %d/%d\n",ok,nops);fflush(stdout);}
  CK(ANeuralNetworksCompilation_createForDevices(M,ds,1,&C[l]));ANeuralNetworksCompilation_setPreference(C[l],ANEURALNETWORKS_PREFER_SUSTAINED_SPEED);
  double t=now();CK(ANeuralNetworksCompilation_finish(C[l]));for(int i=0;i<nhw;i++)free(HW[i]);nhw=0;if(l%6==5||l==0)printf(" layer %d compiled %.0fms memAvail %ldMB rssKB %ld\n",l,now()-t,memavail(),({long r=0;FILE*f=fopen("/proc/self/statm","r");long a;fscanf(f,"%ld %ld",&a,&r);fclose(f);r*4;}));fflush(stdout);
  CK(ANeuralNetworksBurst_create(C[l],&B[l]));CK(ANeuralNetworksExecution_create(C[l],&E[l]));CK(ANeuralNetworksExecution_setReusable(E[l],true));
  CK(ANeuralNetworksExecution_setInput(E[l],0,NULL,buf[l%2],sz));CK(ANeuralNetworksExecution_setOutput(E[l],0,NULL,buf[(l+1)%2],sz));
 }
 if(getenv("SNAP0"))system(getenv("SNAP0"));
 double best=1e18,sum=0,first=0;for(int r=0;r<R+3;r++){double t=now();for(int l=0;l<L;l++)CK(ANeuralNetworksExecution_burstCompute(E[l],B[l]));double d=now()-t;if(r==0)first=d;if(r>=3){sum+=d;if(d<best)best=d;}}
 if(getenv("SNAP1"))system(getenv("SNAP1"));
 int nz=0;for(size_t i=0;i<sz;i++)nz+=buf[L%2][i]!=0;
 printf("RESULT N=%d L=%d first %.2fms warm best %.2f avg %.2f ms per pass (%.2f ms/layer) nonzero-out %d/%zu memAvail %ldMB\n",N,L,first,best,sum/R,best/L,nz,sz,memavail());return 0;}
