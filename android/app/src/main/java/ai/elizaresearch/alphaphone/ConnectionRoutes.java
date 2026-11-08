package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.agent.connection.CloudConnectionPolicy;

/**
 * Alpha's renderer transport route policy: the shared plugin-native-agent CloudConnectionPolicy with Alpha's
 * Eliza Cloud deployment hosts (CloudDeployment, generated from config/cloud-deployment.json) and Google consent as
 * the one external provider. A flag-off build contacts only https://api.eliza.app; a dedicated Cloud agent runtime
 * and a paired remote agent are refused from the URL alone (P-22/P-31, #406). Native Eliza Cloud sign-in sends its
 * fixed routes only through the shared sign-in client (ai.eliza.auth.cloud.CloudSignInRoutes, registered by
 * AlphaCloudSignInPlugin); this transport admits none of them. The Cloud sign-in hand-off is a test-mocks diagnostic route only.
 */
final class ConnectionRoutes {
 private ConnectionRoutes() {}
 static final CloudConnectionPolicy POLICY=new CloudConnectionPolicy(new CloudConnectionPolicy.Hosts(
  CloudDeployment.PRODUCTION_API_HOST,CloudDeployment.STAGING_API_HOST,CloudDeployment.PRODUCTION_WEB_HOST,CloudDeployment.STAGING_WEB_HOST,
  CloudDeployment.PRODUCTION_SERVICES_HOST,CloudDeployment.STAGING_SERVICES_HOST,java.util.Collections.singleton("accounts.google.com")));
 static boolean retiredPairing(String decodedPath,boolean testMocks){return POLICY.retiredPairing(decodedPath,testMocks);}
 static boolean admittedOrigin(String scheme,String host,int port,boolean testMocks){return POLICY.admittedOrigin(scheme,host,port,testMocks);}
 /**
  * The Cloud sign-in hand-off (/api/auth/cli-session and its poll) is a test-mocks diagnostic route only (AP-03, #734):
  * product builds sign in through the native host, so Alpha refuses it flag-off ahead of the shared route set.
  */
 static boolean cloudSignInHandOff(String path){return path!=null&&("/api/auth/cli-session".equals(path)||path.startsWith("/api/auth/cli-session/"));}
 static boolean managedService(String path,String query,String method,boolean hasBody,boolean testMocks){return (testMocks||!cloudSignInHandOff(path))&&POLICY.managedService(path,query,method,hasBody,testMocks);}
 static boolean calendarSync(String path,String query,String method,boolean hasBody){return CloudConnectionPolicy.calendarSync(path,query,method,hasBody);}
 static boolean externalHost(String scheme,String host,int port,boolean testMocks){return POLICY.externalHost(scheme,host,port,testMocks);}
 static boolean externalCliLogin(String host,String path,boolean testMocks){return POLICY.externalCliLogin(host,path,testMocks);}
 static boolean admittedHeader(String name,boolean testMocks){return CloudConnectionPolicy.admittedHeader(name,testMocks);}
 static boolean mapsRequestIdentity(String name,String value,String path,String method){return CloudConnectionPolicy.mapsRequestIdentity(name,value,path,method);}
 static boolean cloudSelfRevocation(String scheme,String host,int port,String rawPath,String rawQuery,String method,boolean hasBody,boolean testMocks){return POLICY.cloudSelfRevocation(scheme,host,port,rawPath,rawQuery,method,hasBody,testMocks);}
}
