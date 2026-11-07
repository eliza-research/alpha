package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.agent.connection.OwnerRoutePolicy;

/** Alpha's packaged owner-route table (config/owner-routes.json, the owner-routes.json asset); the renderer reads the same
 * table through owner-route-policy.ts. The interpreter is the shared plugin-native-agent OwnerRoutePolicy. */
final class OwnerRoutes {
 interface Assets extends OwnerRoutePolicy.Assets {}
 static final String ASSET="owner-routes.json";
 private static final OwnerRoutePolicy.Shipped SHIPPED=new OwnerRoutePolicy.Shipped(ASSET);
 private final OwnerRoutePolicy policy;
 private OwnerRoutes(OwnerRoutePolicy policy){this.policy=policy;}
 /** The packaged table, read once per process. A load failure is an IllegalStateException, which callers refuse on; it is not cached. */
 static OwnerRoutes shipped(OwnerRoutePolicy.Assets assets){return new OwnerRoutes(SHIPPED.get(assets));}
 String group(String path,String... among){return policy.group(path,among);}
 boolean allowed(String name,String path,String method){return policy.allowed(name,path,method);}
}
