const baseUrl = "http://ec2-15-237-116-133.eu-west-3.compute.amazonaws.com:8443";
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoiNDcyMmEyZDYtNjZjZC00Mzk1LWIzY2QtMGQ1MDlkZDU3YmVkIiwicm9sZXMiOlsiVVNFUiJdfQ.KgwVbxM3zaG71O3eul9R3NVINhdeS180fvEYTlQEi3A";
const signupCode = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjb2RpbmdnYW1lIiwic3ViIjoidGhlb2x1Y2FzMjAwMjcyQGdtYWlsLmNvbSJ9.s1NeOijHxJ2NLUETPy1jZY3z0m5CdosLQ3GSzz2hUBk";
const shipId = "46c3bd86-738d-4db9-a161-acf1bb38b652";



axios.get(`${baseUrl}/players/details`,{
    headers:{
        "codinggame-id":token
    }
}).then(res => console.log(res.data))