import { Link } from "react-router-dom";

const Terms = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm p-8">
        <div className="mb-8">
          <Link to="/" className="text-blue-600 hover:text-blue-800 text-sm">
            ← Quay lại trang chủ
          </Link>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Điều khoản dịch vụ</h1>
        <p className="text-sm text-gray-500 mb-8">Cập nhật lần cuối: 13/01/2026</p>

        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Giới thiệu</h2>
            <p>
              Chào mừng bạn đến với Betacom Agency. Bằng việc truy cập và sử dụng dịch vụ của chúng tôi tại 
              ops.betacom.agency, bạn đồng ý tuân thủ các điều khoản và điều kiện được nêu trong tài liệu này.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Định nghĩa</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>"Dịch vụ"</strong> là nền tảng quản lý Shopee API và TikTok Shop API do Betacom Agency cung cấp.</li>
              <li><strong>"Người dùng"</strong> là cá nhân hoặc tổ chức sử dụng Dịch vụ của chúng tôi.</li>
              <li><strong>"Tài khoản"</strong> là tài khoản được tạo để truy cập Dịch vụ.</li>
              <li><strong>"Nền tảng đối tác"</strong> bao gồm Shopee và TikTok Shop.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Điều kiện sử dụng</h2>
            <p className="mb-3">Khi sử dụng Dịch vụ, bạn cam kết:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Cung cấp thông tin chính xác và đầy đủ khi đăng ký tài khoản.</li>
              <li>Bảo mật thông tin đăng nhập và chịu trách nhiệm về mọi hoạt động dưới tài khoản của bạn.</li>
              <li>Không sử dụng Dịch vụ cho mục đích bất hợp pháp hoặc vi phạm quy định của Shopee và TikTok Shop.</li>
              <li>Tuân thủ các chính sách và hướng dẫn của Shopee API và TikTok Shop API.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Quyền sở hữu trí tuệ</h2>
            <p>
              Tất cả nội dung, thiết kế, logo và mã nguồn của Dịch vụ thuộc quyền sở hữu của Betacom Agency. 
              Bạn không được sao chép, phân phối hoặc sử dụng bất kỳ phần nào của Dịch vụ mà không có sự 
              cho phép bằng văn bản từ chúng tôi.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Giới hạn trách nhiệm</h2>
            <p>
              Betacom Agency không chịu trách nhiệm về bất kỳ thiệt hại trực tiếp, gián tiếp, ngẫu nhiên 
              hoặc hậu quả nào phát sinh từ việc sử dụng hoặc không thể sử dụng Dịch vụ. Chúng tôi không 
              đảm bảo Dịch vụ sẽ hoạt động liên tục hoặc không có lỗi.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Chấm dứt dịch vụ</h2>
            <p>
              Chúng tôi có quyền tạm ngưng hoặc chấm dứt quyền truy cập của bạn vào Dịch vụ bất cứ lúc nào, 
              có hoặc không có lý do, và có hoặc không có thông báo trước.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Thay đổi điều khoản</h2>
            <p>
              Chúng tôi có thể cập nhật các Điều khoản này theo thời gian. Việc tiếp tục sử dụng Dịch vụ 
              sau khi có thay đổi đồng nghĩa với việc bạn chấp nhận các điều khoản mới.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Liên hệ</h2>
            <p>
              Nếu bạn có bất kỳ câu hỏi nào về Điều khoản dịch vụ này, vui lòng liên hệ với chúng tôi qua 
              email: <a href="mailto:kiendt120702@gmail.com" className="text-blue-600 hover:underline">kiendt120702@gmail.com</a>
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-500 text-center">
            © 2026 Betacom Agency. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Terms;
