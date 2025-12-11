#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const cdk_verified_access_ecs_stack_1 = require("../lib/cdk-verified-access-ecs-stack");
const app = new cdk.App();
// 環境変数から設定を取得
const adminGroupId = process.env.ADMIN_GROUP_ID || ''; // IAM Identity Centerの管理者グループID
const hrGroupId = process.env.HR_GROUP_ID || ''; // IAM Identity Centerの人事部グループID
const applicationDomain = process.env.APPLICATION_DOMAIN || 'verified-access-ecs.example.com';
const domainCertificateArn = process.env.DOMAIN_CERTIFICATE_ARN || '';
if (!adminGroupId) {
    throw new Error('ADMIN_GROUP_ID environment variable is required');
}
if (!hrGroupId) {
    throw new Error('HR_GROUP_ID environment variable is required');
}
new cdk_verified_access_ecs_stack_1.CdkVerifiedAccessEcsStack(app, 'CdkVerifiedAccessEcsStack', {
    adminGroupId: adminGroupId.trim(),
    hrGroupId: hrGroupId.trim(),
    applicationDomain,
    domainCertificateArn,
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2RrLXZlcmlmaWVkLWFjY2Vzcy1lY3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjZGstdmVyaWZpZWQtYWNjZXNzLWVjcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLHdGQUFpRjtBQUVqRixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQixjQUFjO0FBQ2QsTUFBTSxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLElBQUksRUFBRSxDQUFDLENBQUMsZ0NBQWdDO0FBQ3ZGLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFDLGdDQUFnQztBQUNqRixNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksaUNBQWlDLENBQUM7QUFDOUYsTUFBTSxvQkFBb0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixJQUFJLEVBQUUsQ0FBQztBQUV0RSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDbEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxpREFBaUQsQ0FBQyxDQUFDO0FBQ3JFLENBQUM7QUFFRCxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7SUFDZixNQUFNLElBQUksS0FBSyxDQUFDLDhDQUE4QyxDQUFDLENBQUM7QUFDbEUsQ0FBQztBQUVELElBQUkseURBQXlCLENBQUMsR0FBRyxFQUFFLDJCQUEyQixFQUFFO0lBQzlELFlBQVksRUFBRSxZQUFZLENBQUMsSUFBSSxFQUFFO0lBQ2pDLFNBQVMsRUFBRSxTQUFTLENBQUMsSUFBSSxFQUFFO0lBQzNCLGlCQUFpQjtJQUNqQixvQkFBb0I7SUFDcEIsR0FBRyxFQUFFO1FBQ0gsT0FBTyxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1FBQ3hDLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixJQUFJLGdCQUFnQjtLQUMzRDtDQUNGLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDZGtWZXJpZmllZEFjY2Vzc0Vjc1N0YWNrIH0gZnJvbSAnLi4vbGliL2Nkay12ZXJpZmllZC1hY2Nlc3MtZWNzLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8g55Kw5aKD5aSJ5pWw44GL44KJ6Kit5a6a44KS5Y+W5b6XXG5jb25zdCBhZG1pbkdyb3VwSWQgPSBwcm9jZXNzLmVudi5BRE1JTl9HUk9VUF9JRCB8fCAnJzsgLy8gSUFNIElkZW50aXR5IENlbnRlcuOBrueuoeeQhuiAheOCsOODq+ODvOODl0lEXG5jb25zdCBockdyb3VwSWQgPSBwcm9jZXNzLmVudi5IUl9HUk9VUF9JRCB8fCAnJzsgLy8gSUFNIElkZW50aXR5IENlbnRlcuOBruS6uuS6i+mDqOOCsOODq+ODvOODl0lEXG5jb25zdCBhcHBsaWNhdGlvbkRvbWFpbiA9IHByb2Nlc3MuZW52LkFQUExJQ0FUSU9OX0RPTUFJTiB8fCAndmVyaWZpZWQtYWNjZXNzLWVjcy5leGFtcGxlLmNvbSc7XG5jb25zdCBkb21haW5DZXJ0aWZpY2F0ZUFybiA9IHByb2Nlc3MuZW52LkRPTUFJTl9DRVJUSUZJQ0FURV9BUk4gfHwgJyc7XG5cbmlmICghYWRtaW5Hcm91cElkKSB7XG4gIHRocm93IG5ldyBFcnJvcignQURNSU5fR1JPVVBfSUQgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcbn1cblxuaWYgKCFockdyb3VwSWQpIHtcbiAgdGhyb3cgbmV3IEVycm9yKCdIUl9HUk9VUF9JRCBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xufVxuXG5uZXcgQ2RrVmVyaWZpZWRBY2Nlc3NFY3NTdGFjayhhcHAsICdDZGtWZXJpZmllZEFjY2Vzc0Vjc1N0YWNrJywge1xuICBhZG1pbkdyb3VwSWQ6IGFkbWluR3JvdXBJZC50cmltKCksXG4gIGhyR3JvdXBJZDogaHJHcm91cElkLnRyaW0oKSxcbiAgYXBwbGljYXRpb25Eb21haW4sXG4gIGRvbWFpbkNlcnRpZmljYXRlQXJuLFxuICBlbnY6IHtcbiAgICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5ULFxuICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OIHx8ICdhcC1ub3J0aGVhc3QtMScsXG4gIH0sXG59KTtcblxuIl19