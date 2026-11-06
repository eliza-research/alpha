// Honest TPU probe: distinct weights, random input, reference check, driver/hardware timing.
#include <android/NeuralNetworks.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>
static double now(){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1e3+t.tv_nsec/1e6;}
#define CK(x) do{int r_=(x);if(r_){printf("  FAIL %s = %d\n",#x,r_);return r_;}}while(0)
static unsigned long long st=88172645463325252ULL;static inline unsigned rnd(){st^=st<<13;st^=st>>7;st^=st<<17;return (unsigned)(st>>32);}
static const float SI=0.05f,SW=0.02f;
static int run(ANeuralNetworksDevice*dev,int N,int pairs,int check){
 ANeuralNetworksModel*m;CK(ANeuralNetworksModel_create(&m));
 int K=1024,F=4096;uint32_t idx=0;int code=ANEURALNETWORKS_TENSOR_QUANT8_ASYMM_SIGNED;
 signed char**W=malloc(sizeof(void*)*pairs*2);int32_t*bz=calloc(F,4);
 ANeuralNetworksOperandType sc={ANEURALNETWORKS_INT32,0,0,0,0};
 uint32_t din[2]={N,K},dh[2]={N,F},dw1[2]={F,K},dw2[2]={K,F},db1[1]={F},db2[1]={K};
 ANeuralNetworksOperandType tin={code,2,din,SI,0},th={code,2,dh,SI,0},tw1={code,2,dw1,SW,0},tw2={code,2,dw2,SW,0},tb1={ANEURALNETWORKS_TENSOR_INT32,1,db1,SI*SW,0},tb2={ANEURALNETWORKS_TENSOR_INT32,1,db2,SI*SW,0};
 CK(ANeuralNetworksModel_addOperand(m,&tin));uint32_t in=idx++,cur=in;
 CK(ANeuralNetworksModel_addOperand(m,&sc));uint32_t act=idx++;int32_t none=ANEURALNETWORKS_FUSED_NONE,relu=ANEURALNETWORKS_FUSED_RELU;CK(ANeuralNetworksModel_setOperandValue(m,act,&relu,4));
 CK(ANeuralNetworksModel_addOperand(m,&sc));uint32_t act0=idx++;CK(ANeuralNetworksModel_setOperandValue(m,act0,&none,4));
 for(int p=0;p<pairs;p++){
  for(int q=0;q<2;q++){W[p*2+q]=malloc((size_t)K*F);for(size_t i=0;i<(size_t)K*F;i++)W[p*2+q][i]=(signed char)(rnd()%5)-2;}
  uint32_t a=idx++;CK(ANeuralNetworksModel_addOperand(m,&tw1));CK(ANeuralNetworksModel_setOperandValue(m,a,W[p*2],(size_t)K*F));
  uint32_t b=idx++;CK(ANeuralNetworksModel_addOperand(m,&tb1));CK(ANeuralNetworksModel_setOperandValue(m,b,bz,F*4));
  uint32_t h=idx++;CK(ANeuralNetworksModel_addOperand(m,&th));
  uint32_t i1[4]={cur,a,b,act},o1[1]={h};CK(ANeuralNetworksModel_addOperation(m,ANEURALNETWORKS_FULLY_CONNECTED,4,i1,1,o1));
  uint32_t c=idx++;CK(ANeuralNetworksModel_addOperand(m,&tw2));CK(ANeuralNetworksModel_setOperandValue(m,c,W[p*2+1],(size_t)K*F));
  uint32_t d=idx++;CK(ANeuralNetworksModel_addOperand(m,&tb2));CK(ANeuralNetworksModel_setOperandValue(m,d,bz,K*4));
  uint32_t o=idx++;CK(ANeuralNetworksModel_addOperand(m,&tin));
  uint32_t i2[4]={h,c,d,act0},o2[1]={o};CK(ANeuralNetworksModel_addOperation(m,ANEURALNETWORKS_FULLY_CONNECTED,4,i2,1,o2));cur=o;}
 uint32_t ins[1]={in},outs[1]={cur};CK(ANeuralNetworksModel_identifyInputsAndOutputs(m,1,ins,1,outs));CK(ANeuralNetworksModel_finish(m));
 const ANeuralNetworksDevice*ds[1]={dev};ANeuralNetworksCompilation*c;CK(ANeuralNetworksCompilation_createForDevices(m,ds,1,&c));
 ANeuralNetworksCompilation_setPreference(c,ANEURALNETWORKS_PREFER_SUSTAINED_SPEED);
 double t0=now();int rc=ANeuralNetworksCompilation_finish(c);double cms=now()-t0;if(rc){printf(" N=%d pairs=%d compile rc=%d\n",N,pairs,rc);return rc;}
 size_t isz=(size_t)N*K;signed char*xi=malloc(isz),*xo=calloc(isz,1);for(size_t i=0;i<isz;i++)xi[i]=(signed char)(rnd()%17)-8;
 double best=1e18,sum=0;uint64_t hw=0,drv=0;int R=6;
 for(int r=0;r<R+2;r++){ANeuralNetworksExecution*e;CK(ANeuralNetworksExecution_create(c,&e));ANeuralNetworksExecution_setMeasureTiming(e,true);
  CK(ANeuralNetworksExecution_setInput(e,0,NULL,xi,isz));CK(ANeuralNetworksExecution_setOutput(e,0,NULL,xo,isz));
  double t=now();int q=ANeuralNetworksExecution_compute(e);double d=now()-t;if(q){printf("  exec rc=%d\n",q);return q;}
  ANeuralNetworksExecution_getDuration(e,ANEURALNETWORKS_DURATION_ON_HARDWARE,&hw);ANeuralNetworksExecution_getDuration(e,ANEURALNETWORKS_DURATION_IN_DRIVER,&drv);
  ANeuralNetworksExecution_free(e);if(r>=2){sum+=d;if(d<best)best=d;}}
 double gop=2.0*N*pairs*2.0*K*F/1e9;
 printf(" N=%3d %3.0fM wts compile %.0fms wall best %.2f avg %.2f ms = %.0f GOPS | hw %.2f drv %.2f ms\n",N,pairs*2.0*K*F/1e6,cms,best,sum/R,gop/(best/1e3),hw==UINT64_MAX?-1:hw/1e6,drv==UINT64_MAX?-1:drv/1e6);
 if(check&&pairs==1){signed char*h=malloc((size_t)N*F);long bad=0,tot=0,nz=0;int maxd=0;
  for(int n=0;n<N;n++)for(int f=0;f<F;f++){int a=0;for(int k=0;k<K;k++)a+=xi[n*K+k]*W[0][(size_t)f*K+k];int v=(int)lrintf(a*SW);if(v<0)v=0;if(v>127)v=127;h[(size_t)n*F+f]=v;}
  for(int n=0;n<N;n++)for(int k=0;k<K;k++){int a=0;for(int f=0;f<F;f++)a+=h[(size_t)n*F+f]*W[1][(size_t)k*F+f];int v=(int)lrintf(a*SW);if(v<-128)v=-128;if(v>127)v=127;int dlt=abs(v-xo[n*K+k]);if(dlt>maxd)maxd=dlt;if(dlt>1)bad++;if(xo[n*K+k])nz++;tot++;}
  printf("   check vs CPU reference: %ld/%ld off by >1, max diff %d, nonzero out %ld\n",bad,tot,maxd,nz);free(h);}
 ANeuralNetworksCompilation_free(c);ANeuralNetworksModel_free(m);for(int i=0;i<pairs*2;i++)free(W[i]);free(W);free(bz);free(xi);free(xo);return 0;}
int main(int ac,char**av){uint32_t n=0;ANeuralNetworks_getDeviceCount(&n);ANeuralNetworksDevice*tpu=NULL;
 for(uint32_t i=0;i<n;i++){ANeuralNetworksDevice*d;ANeuralNetworks_getDevice(i,&d);const char*nm;ANeuralNetworksDevice_getName(d,&nm);if(strstr(nm,"edgetpu"))tpu=d;}
 printf("uid-context devices=%u tpu=%s\n",n,tpu?"yes":"no");if(!tpu)return 2;
 run(tpu,75,1,1);
 int Ns[]={8,16,32,48,64,75,125};for(int i=0;i<7;i++)run(tpu,Ns[i],6,0);
 if(ac>1)run(tpu,75,atoi(av[1]),0);
 return 0;}
